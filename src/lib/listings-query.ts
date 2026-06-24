"use server"

import { db } from "@/db"
import { listings, listingLocations, listingPhotos } from "@/db/schema/listings"
import { and, desc, asc, lt, gt, inArray, gte, lte, eq, ilike, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"
import { EARTH_RADIUS_MILES, boundingBox } from "@/lib/geo"

const PAGE_SIZE = 12

export type ListingSort = "newest" | "price-asc" | "price-desc" | "distance"

export interface ListingFilters {
  types?: string[]
  states?: string[]
  minPrice?: number
  maxPrice?: number
  cursor?: string // ISO createdAt (most sorts) or numeric distance (distance sort)
  sort?: ListingSort
  query?: string // text search: location name, city, or notes
  minYearsOpen?: number // minimum years a location has been open
  // Radius search (all three required together)
  centerLat?: number
  centerLng?: number
  radiusMiles?: number
}

export interface ListingCard {
  id: string
  type: "suite" | "flagship" | "territory" | "bundle"
  locationName: string | null
  city: string | null
  state: string | null
  askingPrice: number
  latitude: number | null
  longitude: number | null
  createdAt: Date
  primaryPhotoUrl: string | null
  distanceMiles: number | null // populated only when a search center is active
}

export interface ListingsResult {
  items: ListingCard[]
  nextCursor: string | null
}

// Validate the radius inputs. If they're absent or invalid we simply skip the
// radius filter (the URL state is user-controlled, so don't throw on bad input).
const radiusParamsSchema = z.object({
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusMiles: z.number().positive().max(500),
})

export async function getListings(filters: ListingFilters): Promise<ListingsResult> {
  const { types, states, minPrice, maxPrice, cursor, query, minYearsOpen } = filters

  // --- Resolve the optional radius search ---------------------------------
  const radius = radiusParamsSchema.safeParse({
    centerLat: filters.centerLat,
    centerLng: filters.centerLng,
    radiusMiles: filters.radiusMiles,
  })
  const center = radius.success ? radius.data : null

  // Distance sort only makes sense with a center; otherwise fall back to newest.
  const sort: ListingSort =
    filters.sort === "distance" && !center ? "newest" : filters.sort ?? "newest"

  // Build the per-listing minimum-distance subquery (only when searching).
  // A listing matches if ANY of its locations is within radiusMiles. Salon
  // locations use latitude/longitude; territory locations use territoryLat/Lng
  // — COALESCE picks whichever the row has. Point-based for now; a future
  // refinement could treat territories as circles (territoryRadius overlap).
  let distanceSub: ReturnType<typeof buildDistanceSub> | null = null
  if (center) {
    distanceSub = buildDistanceSub(center.centerLat, center.centerLng, center.radiusMiles)
  }

  // --- Shared WHERE conditions (compose with the radius filter) ------------
  const conditions = [
    eq(listings.status, "active"),
    types && types.length > 0
      ? inArray(listings.type, types as ("suite" | "flagship" | "territory" | "bundle")[])
      : undefined,
    states && states.length > 0 ? inArray(listingLocations.state, states) : undefined,
    minPrice !== undefined ? gte(listings.askingPrice, minPrice) : undefined,
    maxPrice !== undefined ? lte(listings.askingPrice, maxPrice) : undefined,
    query && query.trim()
      ? or(
          ilike(listingLocations.name, `%${query.trim()}%`),
          ilike(listingLocations.city, `%${query.trim()}%`),
          ilike(listings.notes, `%${query.trim()}%`)
        )
      : undefined,
    minYearsOpen && minYearsOpen > 0
      ? lte(listingLocations.openingDate, new Date(Date.now() - minYearsOpen * 365.25 * 24 * 60 * 60 * 1000))
      : undefined,
    // Radius gate: only listings whose nearest location is within the radius.
    // (The subquery's bounding box is a square; this trims the corners.)
    distanceSub ? lte(distanceSub.distance, center!.radiusMiles) : undefined,
    // Keyset pagination — numeric distance for distance sort, else createdAt.
    cursor && sort === "distance" && distanceSub
      ? gt(distanceSub.distance, Number(cursor))
      : cursor && sort !== "distance"
        ? lt(listings.createdAt, new Date(cursor))
        : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined)

  // --- Sort order ----------------------------------------------------------
  const orderBy =
    sort === "distance" && distanceSub
      ? asc(distanceSub.distance)
      : sort === "price-asc"
        ? asc(listings.askingPrice)
        : sort === "price-desc"
          ? desc(listings.askingPrice)
          : desc(listings.createdAt) // "newest" default

  // --- Query ---------------------------------------------------------------
  // When searching, the card/pin reflect the nearest MATCHED location (which is
  // what put the listing in range), not the displayOrder-0 primary — otherwise
  // a bundle can show a primary location that sits outside the search circle.
  // The displayOrder-0 join is still used for the state/text/years filters.
  const nearestLoc = alias(listingLocations, "nearest_loc")
  // Cast collapses the alias/base union to one column type for `.select()`; the
  // runtime value is still the chosen table, so the emitted SQL is correct.
  const displayLoc = (distanceSub ? nearestLoc : listingLocations) as typeof listingLocations

  let q = db
    .select({
      listing: {
        id: listings.id,
        type: listings.type,
        askingPrice: listings.askingPrice,
        createdAt: listings.createdAt,
      },
      primaryLocation: {
        name: displayLoc.name,
        city: displayLoc.city,
        state: displayLoc.state,
        latitude: displayLoc.latitude,
        longitude: displayLoc.longitude,
        territoryLat: displayLoc.territoryLat,
        territoryLng: displayLoc.territoryLng,
      },
      primaryPhoto: {
        url: listingPhotos.url,
      },
      distance: distanceSub ? distanceSub.distance : sql<number | null>`NULL`,
    })
    .from(listings)
    .leftJoin(
      listingLocations,
      and(eq(listingLocations.listingId, listings.id), eq(listingLocations.displayOrder, 0))
    )
    .leftJoin(
      listingPhotos,
      and(eq(listingPhotos.listingId, listings.id), eq(listingPhotos.displayOrder, 0))
    )
    .$dynamic()

  // INNER JOIN when searching: excludes listings with no usable coordinates.
  // Also join the nearest matched location for display (label/distance/pin).
  if (distanceSub) {
    q = q
      .innerJoin(distanceSub, eq(distanceSub.listingId, listings.id))
      .leftJoin(nearestLoc, eq(nearestLoc.id, distanceSub.nearestLocationId))
  }

  const rows = await q
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(PAGE_SIZE + 1)

  const hasMore = rows.length > PAGE_SIZE
  const pageRows = rows.slice(0, PAGE_SIZE)

  const items: ListingCard[] = pageRows.map((row) => ({
    id: row.listing.id,
    type: row.listing.type,
    locationName: row.primaryLocation?.name ?? null,
    city: row.primaryLocation?.city ?? null,
    state: row.primaryLocation?.state ?? null,
    askingPrice: row.listing.askingPrice,
    // Prefer the salon coordinates; fall back to the territory center for the map pin.
    latitude: row.primaryLocation?.latitude ?? row.primaryLocation?.territoryLat ?? null,
    longitude: row.primaryLocation?.longitude ?? row.primaryLocation?.territoryLng ?? null,
    createdAt: row.listing.createdAt,
    primaryPhotoUrl: row.primaryPhoto?.url ?? null,
    distanceMiles: row.distance != null ? Number(row.distance) : null,
  }))

  let nextCursor: string | null = null
  if (hasMore) {
    const last = pageRows[PAGE_SIZE - 1]
    nextCursor =
      sort === "distance" && last.distance != null
        ? String(Number(last.distance))
        : last.listing.createdAt.toISOString()
  }

  return { items, nextCursor }
}

/**
 * Subquery returning, per listing, the SINGLE nearest location to the search
 * center: its id and Haversine distance (miles). A lat/lng bounding-box
 * prefilter (index-friendly for salon rows) is applied BEFORE the trig.
 *
 * DISTINCT ON keeps one row per listing — the minimum-distance location — so a
 * multi-location listing (e.g. a bundle) surfaces by whichever location is in
 * range, and the card/pin can show that matched location rather than the
 * displayOrder-0 primary (which may sit outside the radius).
 */
function buildDistanceSub(centerLat: number, centerLng: number, radiusMiles: number) {
  const { latMin, latMax, lngMin, lngMax } = boundingBox(centerLat, centerLng, radiusMiles)

  const effLat = sql`COALESCE(${listingLocations.latitude}, ${listingLocations.territoryLat})`
  const effLng = sql`COALESCE(${listingLocations.longitude}, ${listingLocations.territoryLng})`

  // Haversine: 2R * asin(sqrt(sin²(Δlat/2) + cos(lat1)cos(lat2)sin²(Δlng/2)))
  const haversine = sql<number>`
    ${EARTH_RADIUS_MILES} * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(${effLat} - ${centerLat}) / 2), 2) +
      COS(RADIANS(${centerLat})) * COS(RADIANS(${effLat})) *
      POWER(SIN(RADIANS(${effLng} - ${centerLng}) / 2), 2)
    ))`

  return db
    .selectDistinctOn([listingLocations.listingId], {
      listingId: listingLocations.listingId,
      nearestLocationId: listingLocations.id,
      distance: haversine.as("distance"),
    })
    .from(listingLocations)
    .where(
      and(
        sql`${effLat} IS NOT NULL AND ${effLng} IS NOT NULL`,
        // Bounding box: salon coords OR territory coords within the lat/lng window.
        sql`(
          (${listingLocations.latitude} BETWEEN ${latMin} AND ${latMax}
            AND ${listingLocations.longitude} BETWEEN ${lngMin} AND ${lngMax})
          OR
          (${listingLocations.territoryLat} BETWEEN ${latMin} AND ${latMax}
            AND ${listingLocations.territoryLng} BETWEEN ${lngMin} AND ${lngMax})
        )`
      )
    )
    // DISTINCT ON requires the leading ORDER BY key to match the ON column;
    // the distance tiebreak then selects the nearest location per listing.
    .orderBy(listingLocations.listingId, asc(haversine))
    .as("loc_dist")
}
