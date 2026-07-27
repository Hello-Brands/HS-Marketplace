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
  const matchesByUser = new Map<string, string[]>()
  for (const u of needMatch) {
    const normalized = normalizeEmail(u.email)
    if (!normalized) {
      matchesByUser.set(u.id, [])
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
  }

  const planned: BackfillLinkRow[] = legacy.flatMap((u) =>
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

  if (DRY_RUN) {
    for (const r of planned) console.log(`  ${r.userId} ${r.ownerIdentifier} ${r.source}`)
    console.log("dry run: no writes")
    process.exit(0)
  }

  for (const row of planned) {
    await db
      .insert(userOwnerLinks)
      .values(row)
      .onConflictDoUpdate({
        target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
        set: { source: row.source, updatedAt: sql`now()` },
      })
  }
  console.log(`wrote ${planned.length} rows`)
  process.exit(0)
}

main().catch((e) => {
  console.error("Backfill failed:", e)
  process.exit(1)
})
