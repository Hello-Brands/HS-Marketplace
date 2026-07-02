'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { ListingFormData, ListingStatus } from './types'
import { canTransition } from './status-machine'
import { nextListedAt } from '@/lib/analytics/helpers'
import { getMyOwnerLocations } from '@/lib/owner-directory/data'
import { normalizeName } from '@/lib/data/match'
import { parseUsAddressTail } from '@/lib/geocode/address'
import { geocodeAddress } from '@/lib/geocode/geocode'

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
        // Clear the cost when inventory isn't included so we never persist a stale value.
        inventoryCostEstimate:
          data.inventoryIncluded && data.inventoryCostEstimate
            ? Math.round(data.inventoryCostEstimate * 100)
            : null,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listingId))

    // Update locations. Snapshot the current mappings first so we can carry an
    // admin's prior /admin/data decision across the delete-and-reinsert.
    if (data.locations) {
      const existingRows = await db
        .select({
          name: listingLocations.name,
          bqLocationName: listingLocations.bqLocationName,
          dataMappingStatus: listingLocations.dataMappingStatus,
          city: listingLocations.city,
          state: listingLocations.state,
          zipCode: listingLocations.zipCode,
          latitude: listingLocations.latitude,
          longitude: listingLocations.longitude,
          geocodedAt: listingLocations.geocodedAt,
          geocodeSource: listingLocations.geocodeSource,
        })
        .from(listingLocations)
        .where(eq(listingLocations.listingId, listingId))
      const prior = new Map<string, PriorRow>(
        existingRows.map((r) => [normalizeName(r.name), r]),
      )
      await db.delete(listingLocations).where(eq(listingLocations.listingId, listingId))
      await insertLocations(listingId, data.locations, prior)
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
      inventoryCostEstimate:
        data.inventoryIncluded && data.inventoryCostEstimate
          ? Math.round(data.inventoryCostEstimate * 100)
          : null,
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

// Mirrors the listing_locations.data_mapping_status enum.
type DataMappingStatus = 'unconfirmed' | 'confirmed' | 'not_connected'
// A snapshot of an existing location row, carried across the edit delete-and-
// reinsert so admin mappings and already-resolved geo aren't recomputed/lost.
type PriorRow = {
  bqLocationName: string | null
  dataMappingStatus: DataMappingStatus
  city: string | null
  state: string | null
  zipCode: string | null
  latitude: number | null
  longitude: number | null
  geocodedAt: Date | null
  geocodeSource: string | null
}

type ResolvedGeo = Pick<
  PriorRow,
  'city' | 'state' | 'zipCode' | 'latitude' | 'longitude' | 'geocodedAt' | 'geocodeSource'
>

/**
 * Fill a location's display + map fields. Prefers values already on the prior row
 * (authoritative across edits), then the form payload. For a salon row with an
 * address and nothing resolved yet, it parses city/state/zip from the address
 * tail and geocodes the address for coordinates — both best-effort, so a MapTiler
 * outage never blocks the save (the backfill script catches anything missed).
 */
async function resolveLocationGeo(
  loc: ListingFormData['locations'][number],
  existing: PriorRow | undefined,
): Promise<ResolvedGeo> {
  let city = existing?.city ?? loc.city ?? null
  let state = existing?.state ?? loc.state ?? null
  let zipCode = existing?.zipCode ?? loc.zipCode ?? null
  let latitude = existing?.latitude ?? loc.latitude ?? null
  let longitude = existing?.longitude ?? loc.longitude ?? null
  let geocodedAt = existing?.geocodedAt ?? null
  let geocodeSource = existing?.geocodeSource ?? null

  // Coords supplied directly by the form (e.g. territory) but not yet recorded.
  if (latitude != null && longitude != null && geocodedAt == null) {
    geocodedAt = new Date()
    geocodeSource = geocodeSource ?? 'internal'
  }

  if (loc.type === 'salon' && loc.address) {
    if (city == null || state == null || zipCode == null) {
      const parsed = parseUsAddressTail(loc.address)
      if (parsed) {
        city = city ?? parsed.city
        state = state ?? parsed.state
        zipCode = zipCode ?? parsed.zipCode
      }
    }
    if (latitude == null || longitude == null) {
      const geo = await geocodeAddress(loc.address)
      if (geo) {
        latitude = geo.lat
        longitude = geo.lng
        geocodedAt = new Date()
        geocodeSource = 'maptiler'
      }
    }
  }

  return { city, state, zipCode, latitude, longitude, geocodedAt, geocodeSource }
}

async function insertLocations(
  listingId: string,
  locations: ListingFormData['locations'],
  prior: Map<string, PriorRow>,
) {
  // The BigQuery mapping is derived server-side from the signed-in owner's own
  // directory, never from client-supplied values — a seller must not be able to
  // attach a higher-performing location's financials to their listing. We key on
  // the normalized name (the financial join key; it survives the edit round-trip,
  // unlike the listing_locations row id) and the directory is scoped to this
  // owner, so only locations they actually own can map.
  const { locations: ownerLocs } = await getMyOwnerLocations()
  const directoryByName = new Map(
    ownerLocs.map((o) => [normalizeName(o.blvdLocationName), o]),
  )

  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i]
    const key = normalizeName(loc.name)
    const existing = prior.get(key)
    // Preserve any prior decision (e.g. an admin's /admin/data confirmation or
    // "not connected") across edits; only derive fresh for genuinely new rows.
    // An exact (high-confidence) directory match auto-confirms; anything weaker
    // stays "unconfirmed" and is queued for admin review.
    let bqLocationName: string | null
    let dataMappingStatus: DataMappingStatus
    if (existing) {
      bqLocationName = existing.bqLocationName
      dataMappingStatus = existing.dataMappingStatus
    } else {
      const directory = directoryByName.get(key)
      bqLocationName = directory?.resolvedBqLocationName ?? null
      dataMappingStatus =
        directory?.blvdMatchConfidence === 'high' && bqLocationName !== null
          ? 'confirmed'
          : 'unconfirmed'
    }
    // Auto-fill address components (display) and coordinates (map) — best-effort.
    const geo = await resolveLocationGeo(loc, existing)
    await db.insert(listingLocations).values({
      id: crypto.randomUUID(),
      listingId,
      locationType: loc.type,
      externalId: loc.externalId,
      name: loc.name,
      address: loc.address,
      city: geo.city,
      state: geo.state,
      zipCode: geo.zipCode,
      squareFootage: loc.squareFootage,
      openingDate: loc.openingDate,
      ttmRevenue: loc.ttmRevenue,
      mcr: loc.mcr,
      bqLocationName,
      dataMappingStatus,
      latitude: geo.latitude,
      longitude: geo.longitude,
      geocodedAt: geo.geocodedAt,
      geocodeSource: geo.geocodeSource,
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
