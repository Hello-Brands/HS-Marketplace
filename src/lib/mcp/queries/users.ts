// Everything hanging off one user, for the MCP `get_user` tool.
//
// NOT a use server module.
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { listings } from "@/db/schema/listings"
import { alerts } from "@/db/schema/alerts"
import { favorites } from "@/db/schema/favorites"
import { userOwnerLinks } from "@/db/schema/userOwnerLinks"

const RELATION_LIMIT = 50

export interface UserDetail {
  owner_links: { owner_identifier: string; source: string; updated_at: string }[]
  listings: { id: string; title: string | null; status: string }[]
  alerts: { id: string; name: string | null; notify_enabled: boolean; created_at: string }[]
  favorites: { listing_id: string; created_at: string }[]
}

export async function userDetail(userId: string): Promise<UserDetail> {
  const [linkRows, listingRows, alertRows, favoriteRows] = await Promise.all([
    db
      .select({
        ownerIdentifier: userOwnerLinks.ownerIdentifier,
        source: userOwnerLinks.source,
        updatedAt: userOwnerLinks.updatedAt,
      })
      .from(userOwnerLinks)
      .where(eq(userOwnerLinks.userId, userId)),
    db
      .select({ id: listings.id, title: listings.title, status: listings.status })
      .from(listings)
      .where(eq(listings.sellerId, userId))
      .orderBy(desc(listings.createdAt))
      .limit(RELATION_LIMIT),
    db
      .select({
        id: alerts.id,
        name: alerts.name,
        notifyEnabled: alerts.notifyEnabled,
        createdAt: alerts.createdAt,
      })
      .from(alerts)
      .where(eq(alerts.userId, userId))
      .orderBy(desc(alerts.createdAt))
      .limit(RELATION_LIMIT),
    db
      .select({ listingId: favorites.listingId, createdAt: favorites.createdAt })
      .from(favorites)
      .where(eq(favorites.userId, userId))
      .orderBy(desc(favorites.createdAt))
      .limit(RELATION_LIMIT),
  ])

  return {
    owner_links: linkRows.map((r) => ({
      owner_identifier: r.ownerIdentifier,
      // "revoked" is a real source value, not an absence — surface it as-is so a
      // suppression is never invisible, exactly as the admin panel does.
      source: r.source,
      updated_at: r.updatedAt.toISOString(),
    })),
    listings: listingRows,
    alerts: alertRows.map((r) => ({
      id: r.id,
      name: r.name,
      notify_enabled: r.notifyEnabled,
      created_at: r.createdAt.toISOString(),
    })),
    favorites: favoriteRows.map((r) => ({
      listing_id: r.listingId,
      created_at: r.createdAt.toISOString(),
    })),
  }
}
