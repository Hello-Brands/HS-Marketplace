'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { sendStatusChangeEmail } from '@/lib/email'
import { canTransition } from '@/lib/listings/status-machine'
import { nextListedAt } from '@/lib/analytics/helpers'
import { unresolvedSalonLocations } from '@/lib/data/mapping'
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

  // A listing cannot go active until every salon location's data-source mapping
  // is resolved (confirmed or explicitly not_connected). Wrong/blank mappings
  // would leak the wrong location's financials.
  const mapLocs = await db
    .select({
      id: listingLocations.id,
      name: listingLocations.name,
      locationType: listingLocations.locationType,
      dataMappingStatus: listingLocations.dataMappingStatus,
    })
    .from(listingLocations)
    .where(eq(listingLocations.listingId, listingId))
  const blocking = unresolvedSalonLocations(mapLocs)
  if (blocking.length > 0) {
    throw new Error(`Confirm data mapping for: ${blocking.map((b) => b.name).join(", ")}`)
  }

  await db.update(listings)
    .set({
      status: 'active',
      listedAt: nextListedAt(listing.listedAt ?? null, 'active', new Date()),
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
  const locations = await db.query.listingLocations.findMany({
    where: eq(listingLocations.listingId, listingId),
  })
  const primary = locations.find((l) => l.displayOrder === 0) ?? locations[0]

  await triggerAlertMatching({
    id: listing.id,
    type: listing.type,
    city: primary?.city ?? null,
    state: primary?.state ?? null,
    askingPrice: listing.askingPrice,
    inventoryIncluded: listing.inventoryIncluded,
    locationName: primary?.name ?? listing.title ?? null,
    locations: locations.map((l) => ({
      state: l.state,
      latitude: l.latitude,
      longitude: l.longitude,
      territoryLat: l.territoryLat,
      territoryLng: l.territoryLng,
      openingDate: l.openingDate,
    })),
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
      inventoryCostEstimate:
        (data.inventoryIncluded ?? listing.inventoryIncluded) && data.inventoryCostEstimate
          ? Math.round(data.inventoryCostEstimate * 100)
          : null,
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
