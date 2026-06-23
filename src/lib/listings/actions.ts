'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { ListingFormData, ListingStatus } from './types'
import { canTransition } from './status-machine'

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
    // Update existing draft
    await db.update(listings)
      .set({
        type,
        title,
        askingPrice: (data.askingPrice || 0) * 100,
        ttmProfit: data.ttmProfit ? data.ttmProfit * 100 : null,
        reasonForSelling: data.reasonForSelling,
        notes: data.notes,
        inventoryIncluded: data.inventoryIncluded ?? false,
        laserIncluded: data.laserIncluded ?? false,
        otherAssets: data.otherAssets,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listingId))

    // Update locations
    if (data.locations) {
      await db.delete(listingLocations).where(eq(listingLocations.listingId, listingId))
      await insertLocations(listingId, data.locations)
    }

    // Update photos
    if (data.photos) {
      await db.delete(listingPhotos).where(eq(listingPhotos.listingId, listingId))
      await insertPhotos(listingId, data.photos)
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
      askingPrice: (data.askingPrice || 0) * 100,
      ttmProfit: data.ttmProfit ? data.ttmProfit * 100 : null,
      reasonForSelling: data.reasonForSelling,
      notes: data.notes,
      inventoryIncluded: data.inventoryIncluded ?? false,
      laserIncluded: data.laserIncluded ?? false,
      otherAssets: data.otherAssets,
    })
    .returning({ id: listings.id })

  if (data.locations) {
    await insertLocations(listing.id, data.locations)
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
  const userRole = user.role === 'admin' ? 'admin' : 'seller'

  const [listing] = await db.select()
    .from(listings)
    .where(eq(listings.id, listingId))

  if (!listing) throw new Error('Listing not found')

  // Sellers can only modify their own listings
  if (userRole === 'seller' && listing.sellerId !== user.id) {
    throw new Error('Not authorized')
  }

  // Validate transition
  if (!canTransition(listing.status as ListingStatus, targetStatus, userRole)) {
    throw new Error(`Cannot transition from ${listing.status} to ${targetStatus}`)
  }

  await db.update(listings)
    .set({
      status: targetStatus,
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

async function insertLocations(listingId: string, locations: ListingFormData['locations']) {
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i]
    await db.insert(listingLocations).values({
      id: crypto.randomUUID(),
      listingId,
      locationType: loc.type,
      externalId: loc.externalId,
      name: loc.name,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zipCode: loc.zipCode,
      squareFootage: loc.squareFootage,
      openingDate: loc.openingDate,
      ttmRevenue: loc.ttmRevenue,
      mcr: loc.mcr,
      latitude: loc.latitude,
      longitude: loc.longitude,
      // Coordinates arrive from the seller-location source (internal API / mock).
      // Rows without coords are filled in later by scripts/geocode-locations.ts.
      geocodedAt: loc.latitude != null && loc.longitude != null ? new Date() : null,
      geocodeSource: loc.latitude != null && loc.longitude != null ? "internal_api" : null,
      territoryLat: loc.territoryLat,
      territoryLng: loc.territoryLng,
      territoryRadius: loc.territoryRadius,
      displayOrder: i,
    })
  }
}

async function insertPhotos(listingId: string, photos: ListingFormData['photos']) {
  for (const photo of photos) {
    await db.insert(listingPhotos).values({
      id: photo.id,
      listingId,
      url: photo.url,
      filename: photo.filename,
      displayOrder: photo.order,
    })
  }
}
