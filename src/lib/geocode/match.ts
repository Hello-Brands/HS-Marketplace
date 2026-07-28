// Pure MapTiler response handling (no network, no server-only) so the server
// helper and the standalone backfill script share ONE accept/reject rule
// instead of drifting apart.

/** Relevance at or above which a match is trusted outright. */
export const RELEVANCE_THRESHOLD = 0.8

/**
 * Floor for the validated path below. Measured against the real directory:
 * "650 E Brooklyn Vlg Ave" resolves to "650 E 8th Street" — a DIFFERENT street
 * in the right ZIP — at 0.589, so ZIP agreement alone is not enough to trust a
 * match. 0.7 excludes it while keeping the genuine near-misses (0.71–0.798).
 */
export const RELEVANCE_FLOOR = 0.7

export type GeocodeCandidate = {
  lat: number
  lng: number
  relevance: number
  placeName: string
  placeTypes: string[]
  postalCode: string | null
}

export type MapTilerFeature = {
  center?: [number, number]
  relevance?: number
  place_name?: string
  place_type?: string[]
  context?: { id?: string; text?: string }[]
}

/** Normalize one MapTiler feature into the shape the accept rule needs. */
export function toCandidate(feature: MapTilerFeature | undefined | null): GeocodeCandidate | null {
  if (!feature?.center) return null
  const [lng, lat] = feature.center
  return {
    lat,
    lng,
    relevance: feature.relevance ?? 0,
    placeName: feature.place_name ?? "",
    placeTypes: feature.place_type ?? [],
    postalCode: feature.context?.find((c) => c.id?.startsWith("postal_code"))?.text ?? null,
  }
}

/**
 * Is this a point on a street, rather than the middle of a ZIP or a town?
 *
 * MapTiler answers a query it cannot place precisely with a `postal_code` or
 * `place` centroid — and does so at relevance 1.0, which would sail past the
 * threshold and get written as though it were exact. A ZIP centroid is not a
 * salon location, so it is rejected at every relevance.
 */
export function isStreetLevel(candidate: GeocodeCandidate): boolean {
  return (
    candidate.placeTypes.includes("address") ||
    candidate.placeTypes.includes("street") ||
    candidate.placeTypes.includes("poi")
  )
}

/**
 * Whether to write this match.
 *
 * Two ways in. Above RELEVANCE_THRESHOLD we trust the score. Below it we trust
 * the ANSWER instead: if the geocoder independently reports the same ZIP the
 * address claims, and the hit is street-level and above the floor, the low
 * score reflects messy input rather than a wrong place.
 *
 * Validating beats simply lowering the threshold, which is why it is done this
 * way: "10001 S I-35 Frontage Rd, Austin TX 78747" resolves to a road in
 * Salado, ~150 miles away, at 0.711. A lower threshold would accept it; the ZIP
 * check rejects it (76571 != 78747) while still accepting the Boulder and
 * Pittsburgh matches that are correct but under-scored.
 */
export function isAcceptableMatch(
  candidate: GeocodeCandidate,
  expectedZip: string | null,
): boolean {
  if (!isStreetLevel(candidate)) return false
  if (candidate.relevance >= RELEVANCE_THRESHOLD) return true
  if (!expectedZip) return false
  if (candidate.relevance < RELEVANCE_FLOOR) return false
  return candidate.postalCode === expectedZip
}
