'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { listings } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { ListingFormData, ListingStatus } from './types'
import { canTransition } from './status-machine'
import { nextListedAt } from '@/lib/analytics/helpers'
import { buildListingUpdate } from './build-update'
import {
  insertLocations,
  insertPhotos,
  syncListingLocations,
  syncListingPhotos,
} from './persist'

async function requireSellerAccess() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  if (!session.user.sellerAccess && session.user.role !== 'admin') {
    throw new Error('Seller access required')
  }
  return session.user
}

export async function saveDraft(data: Partial<ListingFormData>, listingId?: string) {
  const user = await requireSellerAccess()

  // Determine type: bundle if >1 location, else use explicit type or infer from location
  const type = data.locations && data.locations.length > 1
    ? 'bundle'
    : data.type || (data.locations?.[0]?.type === 'territory' ? 'territory' : 'suite')

  // Generate title from locations
  const title = data.locations?.map(l => l.name).join(' + ') || 'Untitled Listing'

  if (listingId) {
    // Update existing draft — only by its owner (or an admin). Without this
    // check any seller could overwrite another seller's listing via the
    // draft API route, which passes a client-supplied listingId through.
    const [existing] = await db.select()
      .from(listings)
      .where(eq(listings.id, listingId))

    if (!existing) throw new Error('Listing not found')
    if (existing.sellerId !== user.id && user.role !== 'admin') {
      throw new Error('Not authorized')
    }

    // Normalized money/asset fields come from the single shared helper (DEBT-003/004).
    await db.update(listings)
      .set({
        type,
        title,
        ...buildListingUpdate(data, existing),
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listingId))

    // Replace locations (snapshotting prior BQ mapping/geocode) and photos.
    if (data.locations) {
      await syncListingLocations(listingId, data.locations)
    }
    if (data.photos) {
      await syncListingPhotos(listingId, data.photos)
    }

    return { success: true, listingId }
  }

  // Create new draft
  const [listing] = await db.insert(listings)
    .values({
      sellerId: user.id!,
      type,
      status: 'draft',
      title,
      ...buildListingUpdate(data),
    })
    .returning({ id: listings.id })

  if (data.locations) {
    await insertLocations(listing.id, data.locations, new Map())
  }

  if (data.photos) {
    await insertPhotos(listing.id, data.photos)
  }

  return { success: true, listingId: listing.id }
}

export async function submitListing(listingId: string) {
  const user = await requireSellerAccess()

  const [listing] = await db.select()
    .from(listings)
    .where(eq(listings.id, listingId))

  if (!listing) throw new Error('Listing not found')
  if (listing.sellerId !== user.id && user.role !== 'admin') {
    throw new Error('Not authorized')
  }
  if (listing.status !== 'draft' && listing.status !== 'rejected') {
    throw new Error('Can only submit draft or rejected listings')
  }

  await db.update(listings)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(listings.id, listingId))

  revalidatePath('/seller/listings')
  revalidatePath('/admin/queue')

  return { success: true }
}

export async function updateListing(listingId: string, data: Partial<ListingFormData>) {
  const user = await requireSellerAccess()

  const [listing] = await db.select()
    .from(listings)
    .where(eq(listings.id, listingId))

  if (!listing) throw new Error('Listing not found')
  if (listing.sellerId !== user.id && user.role !== 'admin') {
    throw new Error('Not authorized')
  }

  // Save the updates
  await saveDraft(data, listingId)

  // If rejected, auto-resubmit for review
  if (listing.status === 'rejected') {
    await db.update(listings)
      .set({
        status: 'pending',
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listingId))
  }

  revalidatePath(`/seller/listings/${listingId}`)
  revalidatePath('/seller/listings')
  revalidatePath('/admin/queue')

  return { success: true }
}

export async function changeListingStatus(
  listingId: string,
  targetStatus: ListingStatus,
  reason?: string
) {
  const user = await requireSellerAccess()

  const [listing] = await db.select()
    .from(listings)
    .where(eq(listings.id, listingId))

  if (!listing) throw new Error('Listing not found')

  // The owner manages their own listing as a seller — even if they are also an
  // admin. (This is the seller-area action; admins approve/reject other people's
  // listings through the separate admin-queue path.) Non-owners must be admins.
  const ownsListing = listing.sellerId === user.id
  if (!ownsListing && user.role !== 'admin') {
    throw new Error('Not authorized')
  }
  const userRole: 'seller' | 'admin' = ownsListing ? 'seller' : 'admin'

  // Validate transition
  if (!canTransition(listing.status as ListingStatus, targetStatus, userRole)) {
    throw new Error(`Cannot transition from ${listing.status} to ${targetStatus}`)
  }

  await db.update(listings)
    .set({
      status: targetStatus,
      listedAt: nextListedAt(listing.listedAt ?? null, targetStatus, new Date()),
      rejectionReason: targetStatus === 'rejected' ? reason : null,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId))

  revalidatePath(`/seller/listings/${listingId}`)
  revalidatePath('/seller/listings')
  revalidatePath('/admin/queue')
  revalidatePath('/admin/listings')

  return { success: true }
}
