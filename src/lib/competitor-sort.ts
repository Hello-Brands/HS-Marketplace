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
 * then sort: searched center (when set) → nearest owned salon → opportunities
 * first + newest closure. Pure; the caller resolves session/owner data.
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

  if (ownerPoints.length > 0) {
    return [...annotated].sort(
      (a, b) => (a.ownerDistanceMiles ?? Infinity) - (b.ownerDistanceMiles ?? Infinity)
    )
  }

  const closedTime = (c: AnnotatedCompetitor) =>
    c.closedAt ? Date.parse(c.closedAt) : Number.NEGATIVE_INFINITY
  return [...annotated].sort((a, b) => {
    if (a.isOpportunity !== b.isOpportunity) return a.isOpportunity ? -1 : 1
    return closedTime(b) - closedTime(a)
  })
}
