/**
 * Backfill user_owner_links from the legacy users.owner_identifier /
 * users.owner_link_source scalars.
 *
 * Run:  npx tsx scripts/backfill-user-owner-links.ts --dry-run   (no writes)
 *       npx tsx scripts/backfill-user-owner-links.ts             (live)
 *
 * Requires DATABASE_URL in .env.local. Run AFTER applying
 * drizzle/0005_user_owner_links.sql.
 *
 * Safe to re-run: every write is an upsert keyed on (user_id, owner_identifier),
 * so an interrupted run can simply be run again.
 *
 * Never aborts the whole run because of a single failure (matching the
 * geocode-owner-locations.ts pattern): both the email-match lookup and the
 * write loop catch per-user errors, log them, and keep going. A user whose
 * email-match lookup fails is skipped entirely rather than treated as "no
 * match" — for a deliberately-unlinked user (ownerIdentifier: null, source:
 * "manual") an empty match list means "nothing to revoke", so silently
 * substituting that for a real lookup failure would misrepresent an admin's
 * unlink decision as fully preserved when it wasn't checked at all. Failures
 * are tallied and reported at the end; the process exits non-zero if any
 * occurred, in either phase, so a partially-completed run is never silently
 * mistaken for a clean one.
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/neon-http"
import { neon } from "@neondatabase/serverless"
import { and, eq, ne, sql } from "drizzle-orm"
import { users } from "../src/db/schema/auth"
import { ownerLocations } from "../src/db/schema/ownerLocations"
import { userOwnerLinks } from "../src/db/schema/userOwnerLinks"
import { planBackfillRows, type BackfillLinkRow } from "../src/lib/owner-directory/backfill"
import { normalizeEmail } from "../src/lib/owner-directory/email"

const UNKNOWN_OWNER = "Unknown Owner"
const DRY_RUN = process.argv.includes("--dry-run")

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
  const db = drizzle(neon(process.env.DATABASE_URL))

  const legacy = await db
    .select({
      id: users.id,
      email: users.email,
      ownerIdentifier: users.ownerIdentifier,
      ownerLinkSource: users.ownerLinkSource,
    })
    .from(users)

  // Only users in the "deliberately unlinked" state need the email match.
  const needMatch = legacy.filter((u) => !u.ownerIdentifier && u.ownerLinkSource === "manual")
  console.log(`Looking up email matches for ${needMatch.length} deliberately-unlinked user(s)...`)

  const matchesByUser = new Map<string, string[]>()
  const matchFailures: { userId: string; error: string }[] = []

  for (const u of needMatch) {
    try {
      const normalized = normalizeEmail(u.email)
      if (!normalized) {
        matchesByUser.set(u.id, [])
        console.log(`  ${u.id}: no email on file, 0 owner(s) matched`)
        continue
      }
      const rows = await db
        .selectDistinct({ ownerIdentifier: ownerLocations.ownerIdentifier })
        .from(ownerLocations)
        .where(
          and(
            eq(ownerLocations.ownerContactEmailNormalized, normalized),
            ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER)
          )
        )
      matchesByUser.set(u.id, rows.map((r) => r.ownerIdentifier))
      console.log(`  ${u.id}: ${rows.length} owner(s) matched`)
    } catch (err) {
      // Do NOT default to []: an empty match list means "nothing to revoke"
      // for a deliberately-unlinked user, so passing one in on a lookup
      // failure would silently pass off an unchecked user as fully handled.
      // Skip them entirely and count the failure instead.
      console.error(`  email-match lookup failed for user ${u.id}: ${errorMessage(err)}`)
      matchFailures.push({ userId: u.id, error: errorMessage(err) })
    }
  }

  const failedUserIds = new Set(matchFailures.map((f) => f.userId))

  const planned: BackfillLinkRow[] = legacy
    .filter((u) => !failedUserIds.has(u.id))
    .flatMap((u) =>
      planBackfillRows({
        userId: u.id,
        ownerIdentifier: u.ownerIdentifier,
        ownerLinkSource: u.ownerLinkSource,
        emailMatchedOwners: matchesByUser.get(u.id) ?? [],
      })
    )

  const counts = planned.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + 1
    return acc
  }, {})
  console.log(`${legacy.length} users -> ${planned.length} link rows`, counts)
  if (matchFailures.length) {
    console.log(
      `${matchFailures.length} user(s) skipped entirely due to email-match lookup failures ` +
        `(not included in the plan above): ${matchFailures.map((f) => f.userId).join(", ")}`
    )
  }

  if (DRY_RUN) {
    for (const r of planned) console.log(`  ${r.userId} ${r.ownerIdentifier} ${r.source}`)
    console.log("dry run: no writes")
    process.exit(matchFailures.length > 0 ? 1 : 0)
  }

  let written = 0
  const writeFailures: { userId: string; ownerIdentifier: string; error: string }[] = []

  for (const row of planned) {
    try {
      await db
        .insert(userOwnerLinks)
        .values(row)
        .onConflictDoUpdate({
          target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
          set: { source: row.source, updatedAt: sql`now()` },
        })
      written++
      console.log(`  wrote ${row.userId} ${row.ownerIdentifier} ${row.source}`)
    } catch (err) {
      console.error(
        `  write failed for ${row.userId} ${row.ownerIdentifier}: ${errorMessage(err)}`
      )
      writeFailures.push({
        userId: row.userId,
        ownerIdentifier: row.ownerIdentifier,
        error: errorMessage(err),
      })
    }
  }

  const totalFailures = matchFailures.length + writeFailures.length
  console.log(
    `wrote ${written}/${planned.length} rows; ` +
      `${matchFailures.length} email-match failure(s), ${writeFailures.length} write failure(s)`
  )
  process.exit(totalFailures > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("Backfill failed:", e)
  process.exit(1)
})
