import "server-only"
import type { MondayCoords } from "@/lib/bigquery/queries"

export type CoordFields = {
  latitude: number | null
  longitude: number | null
  geocodedAt: Date | null
  coordSource: string | null
}

/**
 * Decide a synced owner row's stored coordinates.
 *
 * Monday is the absolute source of truth: a number covered by the view gets
 * Monday's coords stamped on EVERY sync, replacing anything prior (even a
 * differing MapTiler geocode). Uncovered rows keep their prior coords —
 * including provenance — and the MapTiler backfill later fills NULLs.
 */
export function resolveOwnerRowCoords(
  blvdLocationNumber: string | null,
  prior: CoordFields | null,
  coords: MondayCoords | null,
  now: Date
): CoordFields {
  const num = blvdLocationNumber?.trim()
  const hit = num && coords ? coords.get(num) : undefined
  if (hit) {
    return { latitude: hit.lat, longitude: hit.lng, geocodedAt: now, coordSource: "monday" }
  }
  return {
    latitude: prior?.latitude ?? null,
    longitude: prior?.longitude ?? null,
    geocodedAt: prior?.geocodedAt ?? null,
    coordSource: prior?.coordSource ?? null,
  }
}
