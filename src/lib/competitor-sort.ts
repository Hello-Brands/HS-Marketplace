import { haversineMiles } from "./geo"
import type { CompetitorClosure } from "./competitor-query"

/** A named coordinate for one of the viewer's owned salons. */
export interface OwnerPoint {
  name: string
  latitude: number
  longitude: number
}

/**
 * CompetitorClosure plus the distance to the viewer's nearest owned salon.
 * Fields are optional so plain CompetitorClosure[] remains assignable — client
 * components read them defensively.
 */
export type AnnotatedCompetitor = CompetitorClosure & {
  ownerDistanceMiles?: number | null
  ownerDistanceFrom?: string | null
}

export interface CompetitorSortContext {
  /** Active searched center (city + radius search); takes sort precedence. */
  searchCenter?: { lat: number; lng: number } | null
  /** The signed-in user's owned salons that have coordinates. */
  ownerPoints?: OwnerPoint[]
}

/** owner_locations rows → OwnerPoints, dropping un-geocoded rows. */
export function toOwnerPoints(
  locations: Array<{
    blvdLocationName: string
    latitude: number | null
    longitude: number | null
  }>
): OwnerPoint[] {
  return locations
    .filter((l) => l.latitude != null && l.longitude != null)
    .map((l) => ({
      name: l.blvdLocationName,
      latitude: l.latitude as number,
      longitude: l.longitude as number,
    }))
}

/**
 * Annotate each closure with the distance to the viewer's nearest owned salon,
 * then sort: searched center (when set) → newest detected closure. Pure; the
 * caller resolves session/owner data.
 *
 * Owner distance is still annotated for the card line, but no longer drives the
 * order: recency is what owners act on, so the newest detections sit on top for
 * everyone. Opportunities keep their badge and get no ordering boost.
 */
export function annotateAndSortCompetitors(
  competitors: CompetitorClosure[],
  ctx: CompetitorSortContext
): AnnotatedCompetitor[] {
  const ownerPoints = ctx.ownerPoints ?? []

  const annotated: AnnotatedCompetitor[] = competitors.map((c) => {
    let best: { d: number; name: string } | null = null
    for (const p of ownerPoints) {
      const d = haversineMiles(p.latitude, p.longitude, c.latitude, c.longitude)
      if (best === null || d < best.d) best = { d, name: p.name }
    }
    return {
      ...c,
      ownerDistanceMiles: best ? best.d : null,
      ownerDistanceFrom: best ? best.name : null,
    }
  })

  const center = ctx.searchCenter
  if (center) {
    return annotated
      .map((c) => ({ c, d: haversineMiles(center.lat, center.lng, c.latitude, c.longitude) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.c)
  }

  // Newest detection first. The 22-of-79 rows with a null (or unparseable)
  // closedAt have no recency to rank on, so they sink to the bottom rather than
  // masquerading as either the newest or the oldest.
  const closedTime = (c: AnnotatedCompetitor) => {
    if (!c.closedAt) return Number.NEGATIVE_INFINITY
    const t = Date.parse(c.closedAt)
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
  }
  return [...annotated].sort((a, b) => closedTime(b) - closedTime(a))
}
