import "server-only"
import { and, eq, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { ownerLocations } from "@/db/schema/ownerLocations"
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

/**
 * Stamp Monday coords onto confirmed salon listing locations via the
 * name→number bridge: listing_locations.bq_location_name =
 * owner_locations.resolved_bq_location_name → blvd_location_number → coords.
 * Multi-owner rows share the same number, so the first covered hit wins.
 * Returns the number of listing locations updated.
 */
export async function applyMondayCoordsToListings(
  coords: MondayCoords,
  now: Date
): Promise<number> {
  const rows = await db
    .select({ id: listingLocations.id, num: ownerLocations.blvdLocationNumber })
    .from(listingLocations)
    .innerJoin(
      ownerLocations,
      eq(ownerLocations.resolvedBqLocationName, listingLocations.bqLocationName)
    )
    .where(
      and(
        eq(listingLocations.locationType, "salon"),
        eq(listingLocations.dataMappingStatus, "confirmed"),
        isNotNull(listingLocations.bqLocationName),
        isNotNull(ownerLocations.blvdLocationNumber)
      )
    )

  const byId = new Map<string, { lat: number; lng: number }>()
  for (const r of rows) {
    if (byId.has(r.id)) continue
    const hit = r.num ? coords.get(r.num.trim()) : undefined
    if (hit) byId.set(r.id, hit)
  }
  if (byId.size === 0) return 0

  const updates = [...byId.entries()].map(([id, c]) =>
    db
      .update(listingLocations)
      .set({ latitude: c.lat, longitude: c.lng, geocodedAt: now, geocodeSource: "monday" })
      .where(eq(listingLocations.id, id))
  )
  // neon-http: one batch = one transaction (no db.transaction on this driver)
  await db.batch(updates as [(typeof updates)[number], ...typeof updates])
  return byId.size
}

/**
 * Monday coords for a single confirmed BigQuery LOCATION_NAME, via any owner
 * row carrying that resolved name. Null when no covered number exists.
 */
export async function mondayCoordsForBqName(
  bqName: string,
  coords: MondayCoords
): Promise<{ lat: number; lng: number } | null> {
  const rows = await db
    .select({ num: ownerLocations.blvdLocationNumber })
    .from(ownerLocations)
    .where(
      and(
        eq(ownerLocations.resolvedBqLocationName, bqName),
        isNotNull(ownerLocations.blvdLocationNumber)
      )
    )
  for (const r of rows) {
    const hit = r.num ? coords.get(r.num.trim()) : undefined
    if (hit) return hit
  }
  return null
}
