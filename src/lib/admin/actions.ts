'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq, desc, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { sendStatusChangeEmail } from '@/lib/email'
import { canTransition } from '@/lib/listings/status-machine'
import { unresolvedSalonLocations } from '@/lib/boulevard/mapping'
import { triggerAlertMatching } from '@/lib/alert-actions'
import type { ListingStatus, ListingFormData } from '@/lib/listings/types'

async function requireAdmin() {
  const session = await auth()
  if (!session?.user) throw new Error('Not authenticated')
  if (session.user.role !== 'admin') throw new Error('Admin access required')
  return session.user
}

export async function getPendingListings() {
  await requireAdmin()

  return db.query.listings.findMany({
    where: eq(listings.status, 'pending'),
    orderBy: [desc(listings.createdAt)],
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder], limit: 1 },
      seller: true,
    },
  })
}

export async function getAllListings(statusFilter?: ListingStatus) {
  await requireAdmin()

  const conditions = statusFilter ? eq(listings.status, statusFilter) : undefined

  return db.query.listings.findMany({
    where: conditions,
    orderBy: [desc(listings.createdAt)],
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder], limit: 1 },
      seller: true,
    },
  })
}

export async function approveListing(listingId: string) {
  await requireAdmin()

  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
    with: { seller: true },
  })

  if (!listing) throw new Error('Listing not found')

  if (!canTransition(listing.status as ListingStatus, 'active', 'admin')) {
    throw new Error(`Cannot approve listing with status ${listing.status}`)
  }

  // Rock 2: a listing cannot go active until every salon location's Boulevard
  // mapping is resolved (confirmed or explicitly not_connected). Wrong/blank
  // mappings would leak the wrong location's financials.
  const mapLocs = await db
    .select({
      id: listingLocations.id,
      name: listingLocations.name,
      locationType: listingLocations.locationType,
      boulevardMappingStatus: listingLocations.boulevardMappingStatus,
    })
    .from(listingLocations)
    .where(eq(listingLocations.listingId, listingId))
  const blocking = unresolvedSalonLocations(mapLocs)
  if (blocking.length > 0) {
    throw new Error(`Confirm Boulevard mapping for: ${blocking.map((b) => b.name).join(", ")}`)
  }

  await db.update(listings)
    .set({
      status: 'active',
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId))

  // Send approval email
  if (listing.seller?.email) {
    await sendStatusChangeEmail({
      recipientEmail: listing.seller.email,
      recipientName: listing.seller.name || 'Seller',
      listingTitle: listing.title || 'Your listing',
      listingId: listing.id,
      newStatus: 'active',
    })
  }

  // Trigger alert emails for buyers with matching alert criteria
  // Fetch primary location for alert matching
  const primaryLocation = await db.query.listingLocations.findFirst({
    where: and(
      eq(listingLocations.listingId, listingId),
      eq(listingLocations.displayOrder, 0)
    ),
  })

  await triggerAlertMatching({
    id: listing.id,
    type: listing.type,
    city: primaryLocation?.city ?? null,
    state: primaryLocation?.state ?? null,
    askingPrice: listing.askingPrice,
    locationName: primaryLocation?.name ?? listing.title ?? null,
  })

  revalidatePath('/admin/queue')
  revalidatePath('/admin/listings')
  revalidatePath(`/seller/listings/${listingId}`)

  return { success: true }
}

export async function rejectListing(listingId: string, reason: string, notes?: string) {
  await requireAdmin()

  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
    with: { seller: true },
  })

  if (!listing) throw new Error('Listing not found')

  if (!canTransition(listing.status as ListingStatus, 'rejected', 'admin')) {
    throw new Error(`Cannot reject listing with status ${listing.status}`)
  }

  const fullReason = notes ? `${reason}: ${notes}` : reason

  await db.update(listings)
    .set({
      status: 'rejected',
      rejectionReason: fullReason,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId))

  // Send rejection email
  if (listing.seller?.email) {
    await sendStatusChangeEmail({
      recipientEmail: listing.seller.email,
      recipientName: listing.seller.name || 'Seller',
      listingTitle: listing.title || 'Your listing',
      listingId: listing.id,
      newStatus: 'rejected',
      rejectionReason: fullReason,
    })
  }

  revalidatePath('/admin/queue')
  revalidatePath('/admin/listings')
  revalidatePath(`/seller/listings/${listingId}`)

  return { success: true }
}

export async function adminUpdateListing(listingId: string, data: Partial<ListingFormData>) {
  await requireAdmin()

  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
  })

  if (!listing) throw new Error('Listing not found')

  // Generate title from locations if provided
  const title = data.locations?.map(l => l.name).join(' + ') || listing.title

  await db.update(listings)
    .set({
      title,
      askingPrice: data.askingPrice ?? listing.askingPrice,
      ttmProfit: data.ttmProfit,
      reasonForSelling: data.reasonForSelling,
      notes: data.notes,
      inventoryIncluded: data.inventoryIncluded ?? listing.inventoryIncluded,
      laserIncluded: data.laserIncluded ?? listing.laserIncluded,
      otherAssets: data.otherAssets,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId))

  revalidatePath('/admin/queue')
  revalidatePath('/admin/listings')
  revalidatePath(`/seller/listings/${listingId}`)

  return { success: true }
}

export async function adminMarkSold(listingId: string) {
  await requireAdmin()

  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId),
  })

  if (!listing) throw new Error('Listing not found')

  if (!canTransition(listing.status as ListingStatus, 'sold', 'admin')) {
    throw new Error(`Cannot mark listing as sold from status ${listing.status}`)
  }

  await db.update(listings)
    .set({
      status: 'sold',
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId))

  revalidatePath('/admin/queue')
  revalidatePath('/admin/listings')
  revalidatePath(`/seller/listings/${listingId}`)

  return { success: true }
}
