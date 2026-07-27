import "server-only"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { ownerLocations, userOwnerLinks } from "@/db/schema"
import { normalizeEmail } from "./email"
import { UNKNOWN_OWNER } from "./query"
import { planOwnerLinks, EMPTY_OWNER_LINK_PLAN, type OwnerLinkPlan } from "./link"
import { getUserOwnerLinks } from "./links"

/**
 * Additive login step: reconcile the user's auto links against every owner
 * profile their directory email matches. A user may hold several profiles —
 * owners appear once per co-ownership grouping — so a multi-match is normal,
 * not ambiguous.
 *
 * Never throws and never blocks sign-in: failures are logged and swallowed so
 * a directory hiccup can never lock anyone out.
 */
export async function linkOwnerAtLogin(
  userId: string,
  email: string | null | undefined
): Promise<OwnerLinkPlan> {
  try {
    const normalized = normalizeEmail(email)
    if (!normalized) return EMPTY_OWNER_LINK_PLAN

    const [matches, existingLinks] = await Promise.all([
      // Distinct owners for this email, excluding the never-linkable bucket.
      db
        .selectDistinct({ ownerIdentifier: ownerLocations.ownerIdentifier })
        .from(ownerLocations)
        .where(
          and(
            eq(ownerLocations.ownerContactEmailNormalized, normalized),
            ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER)
          )
        ),
      getUserOwnerLinks(userId),
    ])

    const plan = planOwnerLinks({
      matchedOwnerIdentifiers: matches.map((m) => m.ownerIdentifier),
      existingLinks,
    })

    const addOp =
      plan.toAdd.length > 0
        ? db
            .insert(userOwnerLinks)
            .values(
              plan.toAdd.map((ownerIdentifier) => ({
                userId,
                ownerIdentifier,
                source: "auto" as const,
              }))
            )
            .onConflictDoNothing()
        : null

    // eq(source, "auto") is a deliberate belt-and-braces guard: toRemove only
    // ever holds auto links, but a manual or revoked row must never be deleted
    // by the automatic path even if that invariant is broken upstream.
    const removeOp =
      plan.toRemove.length > 0
        ? db
            .delete(userOwnerLinks)
            .where(
              and(
                eq(userOwnerLinks.userId, userId),
                eq(userOwnerLinks.source, "auto"),
                inArray(userOwnerLinks.ownerIdentifier, plan.toRemove)
              )
            )
        : null

    // The Neon HTTP driver has no db.transaction; db.batch is the atomic
    // multi-write primitive and rejects an empty array, so branch explicitly.
    if (addOp && removeOp) await db.batch([addOp, removeOp])
    else if (addOp) await addOp
    else if (removeOp) await removeOp

    if (plan.skipped.length > 0) {
      console.info(
        `[owner-link] ${normalized}: skipped ${plan.skipped
          .map((s) => `${s.ownerIdentifier}(${s.reason})`)
          .join(", ")}`
      )
    }
    return plan
  } catch (err) {
    console.warn("[owner-link] linkOwnerAtLogin failed (non-fatal):", err)
    return EMPTY_OWNER_LINK_PLAN
  }
}
