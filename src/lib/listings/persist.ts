import { db } from '@/db'
import { listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import type { ListingFormData } from './types'
import { getMyOwnerLocations } from '@/lib/owner-directory/data'
import { normalizeName } from '@/lib/data/match'
import { parseUsAddressTail } from '@/lib/geocode/address'
import { geocodeAddress } from '@/lib/geocode/geocode'

/**
 * Shared listing write helpers that touch the database. The pure money/scalar
 * normalization lives in `./build-update` (`buildListingUpdate`, re-exported here);
 * this module owns the location/photo persistence (`syncListingLocations` /
 * `syncListingPhotos`) so the seller (`saveDraft`) and admin (`adminUpdateListing`)
 * paths preserve prior BigQuery mappings + geocode snapshots identically. Consolidating
 * both is what closes the drift that let DEBT-001 hide.
 */

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

/**
 * Insert location rows for a listing. Callers pass `prior` (a snapshot of the rows
 * that existed before an edit, keyed by normalized name) so an admin's prior
 * /admin/data mapping decision and already-resolved geo survive the delete-and-reinsert.
 * On a fresh create, pass an empty map.
 */
export async function insertLocations(
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

export async function insertPhotos(listingId: string, photos: ListingFormData['photos']) {
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

/**
 * Replace a listing's locations. Snapshots the current rows first so prior BigQuery
 * mappings + geocode results carry across the delete-and-reinsert, then rewrites them
 * from the form payload. Used by both the seller and admin edit paths.
 */
export async function syncListingLocations(
  listingId: string,
  locations: ListingFormData['locations'],
) {
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
  await insertLocations(listingId, locations, prior)
}

/** Replace a listing's photos (delete-and-reinsert). Used by both edit paths. */
export async function syncListingPhotos(listingId: string, photos: ListingFormData['photos']) {
  await db.delete(listingPhotos).where(eq(listingPhotos.listingId, listingId))
  await insertPhotos(listingId, photos)
}
