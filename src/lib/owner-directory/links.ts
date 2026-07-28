import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { OWNER_LINK_SOURCES, userOwnerLinks, type OwnerLinkSource } from "@/db/schema"
import { isEffectiveLinkSource, type ExistingOwnerLink } from "./link"

/** Sources that grant access, derived from isEffectiveLinkSource so the two can't drift. */
const EFFECTIVE_SOURCES: OwnerLinkSource[] = OWNER_LINK_SOURCES.filter(isEffectiveLinkSource)

/**
 * Every link row for a user, including revoked ones — the reconciler needs
 * revocations to know what to skip.
 */
export async function getUserOwnerLinks(userId: string): Promise<ExistingOwnerLink[]> {
  return db
    .select({
      ownerIdentifier: userOwnerLinks.ownerIdentifier,
      source: userOwnerLinks.source,
    })
    .from(userOwnerLinks)
    .where(eq(userOwnerLinks.userId, userId))
}

/**
 * The owner identifiers a user effectively holds. Revoked links are excluded
 * in the QUERY, not by the caller, so no read path can accidentally honour a
 * suppression.
 */
export async function getEffectiveOwnerIdentifiers(userId: string): Promise<string[]> {
  const rows = await db
    .select({ ownerIdentifier: userOwnerLinks.ownerIdentifier })
    .from(userOwnerLinks)
    .where(
      and(
        eq(userOwnerLinks.userId, userId),
        inArray(userOwnerLinks.source, EFFECTIVE_SOURCES),
      ),
    )
  return rows.map((r) => r.ownerIdentifier)
}
