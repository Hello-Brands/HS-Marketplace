import "server-only"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/db"
import { listings, listingLocations } from "@/db/schema/listings"
import { getMyOwnerLocations } from "@/lib/owner-directory/data"
import {
  computeOwnedListingIds,
  ownedBqNameSet,
  EMPTY_MAP_OWNERSHIP,
  type MapOwnership,
} from "./ownership"

/**
 * Per-request ownership for the /browse map: which active-listing dots and
 * which unlisted HS dots belong to the signed-in user. Computed from the
 * session here so the shared, owner-agnostic map caches never carry owner
 * identity (DEBT-024). Resilient like the other map sources — any failure
 * renders the map without highlights rather than blocking the page.
 */
export async function getMyMapOwnership(): Promise<MapOwnership> {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return EMPTY_MAP_OWNERSHIP

    const { locations } = await getMyOwnerLocations()

    const rows = await db
      .select({
        listingId: listings.id,
        sellerId: listings.sellerId,
        bqLocationName: listingLocations.bqLocationName,
        dataMappingStatus: listingLocations.dataMappingStatus,
      })
      .from(listings)
      .leftJoin(listingLocations, eq(listingLocations.listingId, listings.id))
      .where(eq(listings.status, "active"))

    return {
      ownedListingIds: computeOwnedListingIds(rows, userId, ownedBqNameSet(locations)),
      ownedHsLocationIds: locations.map((l) => l.id),
    }
  } catch (err) {
    console.error("getMyMapOwnership failed; rendering map without owner highlights", err)
    return EMPTY_MAP_OWNERSHIP
  }
}
