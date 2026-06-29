import "server-only"
import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { ownerLocations } from "@/db/schema"
import { normalizeEmail } from "./email"
import { UNKNOWN_OWNER } from "./query"
import { decideOwnerLink, type OwnerLinkDecision } from "./link"

/**
 * Additive login step: match the user's email against the owner directory and
 * link them to their owner_identifier when unambiguous. Never throws and never
 * blocks sign-in — failures are logged and swallowed so a directory hiccup can
 * never lock anyone out. Existing login behaviour is unchanged.
 */
export async function linkOwnerAtLogin(
  userId: string,
  email: string | null | undefined
): Promise<OwnerLinkDecision> {
  try {
    const normalized = normalizeEmail(email)
    if (!normalized) return { action: "skip", reason: "no_match" }

    const current = await db
      .select({ ownerLinkSource: users.ownerLinkSource })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (current.length === 0) return { action: "skip", reason: "no_match" }

    // Distinct owners for this email, excluding the never-linkable Unknown Owner.
    const matches = await db
      .selectDistinct({ ownerIdentifier: ownerLocations.ownerIdentifier })
      .from(ownerLocations)
      .where(
        and(
          eq(ownerLocations.ownerContactEmailNormalized, normalized),
          ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER)
        )
      )

    const decision = decideOwnerLink({
      matchedOwnerIdentifiers: matches.map((m) => m.ownerIdentifier),
      currentLinkSource: current[0].ownerLinkSource,
    })

    if (decision.action === "link") {
      await db
        .update(users)
        .set({ ownerIdentifier: decision.ownerIdentifier, ownerLinkSource: "auto" })
        .where(eq(users.id, userId))
    } else if (decision.reason === "multiple_owners") {
      console.warn(
        `[owner-link] ${normalized} matches multiple owner_identifiers; left unlinked for admin review`
      )
    }
    return decision
  } catch (err) {
    console.warn("[owner-link] linkOwnerAtLogin failed (non-fatal):", err)
    return { action: "skip", reason: "no_match" }
  }
}
