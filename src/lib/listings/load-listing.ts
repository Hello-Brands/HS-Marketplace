import { redirect, notFound } from "next/navigation"
import type { Session } from "next-auth"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { listings, listingLocations, listingPhotos } from "@/db/schema/listings"
import type { users } from "@/db/schema/auth"
import type { ListingWithRelations } from "./to-form-data"

/**
 * Shared loader for the seller/admin listing pages (detail + edit).
 *
 * The four pages under `app/seller/listings/[id]` and `app/admin/listings/[id]`
 * had a near-verbatim copy of the same block: auth check → `findFirst` with the
 * same location/photo relations → `notFound()` guard → (seller only) ownership
 * guard. This module extracts that block once. The two authorization rules stay
 * distinct via the two entry points; behavior — auth rule, loaded relations,
 * and notFound()/redirect() targets — is preserved exactly.
 */

/** A listing with its ordered locations + photos, plus the seller user row. */
export type ListingWithRelationsAndSeller = ListingWithRelations & {
  seller: typeof users.$inferSelect
}

/** Fetch a listing with its ordered locations and photos. */
async function queryListingBase(id: string): Promise<ListingWithRelations | undefined> {
  return db.query.listings.findFirst({
    where: eq(listings.id, id),
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder] },
    },
  })
}

/** Fetch a listing with its ordered locations, photos, and the seller user row. */
async function queryListingWithSeller(
  id: string,
): Promise<ListingWithRelationsAndSeller | undefined> {
  return db.query.listings.findFirst({
    where: eq(listings.id, id),
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder] },
      seller: true,
    },
  })
}

/**
 * Load a listing for the seller-facing pages. Requires an authenticated
 * session (unauthenticated → `/login`), then requires that the current user
 * owns the listing or is an admin (otherwise → `/seller/listings`). A missing
 * listing triggers `notFound()`.
 */
export async function loadSellerListing(
  id: string,
  session: Session | null,
): Promise<ListingWithRelations> {
  if (!session?.user?.id) {
    redirect("/login")
  }

  const listing = await queryListingBase(id)

  if (!listing) {
    notFound()
  }

  if (listing.sellerId !== session.user.id && session.user.role !== "admin") {
    redirect("/seller/listings")
  }

  return listing
}

/**
 * Load a listing for the admin-facing pages. Requires an admin session
 * (otherwise → `/login`) and triggers `notFound()` for a missing listing.
 * Pass `{ withSeller: true }` to also load the seller user row.
 */
export async function loadAdminListing(
  id: string,
  session: Session | null,
): Promise<ListingWithRelations>
export async function loadAdminListing(
  id: string,
  session: Session | null,
  opts: { withSeller: true },
): Promise<ListingWithRelationsAndSeller>
export async function loadAdminListing(
  id: string,
  session: Session | null,
  opts?: { withSeller?: boolean },
): Promise<ListingWithRelations | ListingWithRelationsAndSeller> {
  if (session?.user?.role !== "admin") {
    redirect("/login")
  }

  const listing = opts?.withSeller
    ? await queryListingWithSeller(id)
    : await queryListingBase(id)

  if (!listing) {
    notFound()
  }

  return listing
}
