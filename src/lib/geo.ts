/**
 * Geospatial helpers for radius search.
 *
 * `haversineMiles` is the pure-JS mirror of the Haversine SQL in
 * listings-query.ts — kept here so the distance logic is unit-testable.
 * `boundingBox` is the single source of truth for the bounding-box prefilter.
 */

export const EARTH_RADIUS_MILES = 3959
export const MILES_PER_DEGREE_LAT = 69

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in miles between two lat/lng points. */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.sqrt(a))
}

export function isWithinRadius(
  centerLat: number,
  centerLng: number,
  lat: number,
  lng: number,
  radiusMiles: number
): boolean {
  return haversineMiles(centerLat, centerLng, lat, lng) <= radiusMiles
}

export interface BoundingBox {
  latMin: number
  latMax: number
  lngMin: number
  lngMax: number
}

/**
 * Square lat/lng window that fully contains the search circle. Slightly
 * inclusive by design — it's a cheap, index-friendly prefilter; the precise
 * Haversine check trims it to a circle afterward.
 */
export function boundingBox(
  centerLat: number,
  centerLng: number,
  radiusMiles: number
): BoundingBox {
  const latDelta = radiusMiles / MILES_PER_DEGREE_LAT
  // Longitude degrees shrink with latitude; guard against cos→0 (not relevant for US).
  const cosLat = Math.max(Math.cos(toRad(centerLat)), 0.01)
  const lngDelta = radiusMiles / (MILES_PER_DEGREE_LAT * cosLat)
  return {
    latMin: centerLat - latDelta,
    latMax: centerLat + latDelta,
    lngMin: centerLng - lngDelta,
    lngMax: centerLng + lngDelta,
  }
}
