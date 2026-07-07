import "server-only"
import { unstable_cache } from "next/cache"
import { db } from "@/db"
import { ownerLocations } from "@/db/schema"
import { listings, listingLocations } from "@/db/schema/listings"
import { and, eq, gte, lte, isNotNull, or, sql } from "drizzle-orm"
import { boundingBox } from "./geo"
import { parseUsAddressTail } from "./geocode/address"
import type { CompetitorScope } from "./competitor-filter"
import {
  isLocationOpen,
  isNotListed,
  hsLocationInScope,
  locationDedupeKey,
  openedSinceYear,
  type UnlistedHsLocation,
} from "./hs-locations-filter"

/** Escape regex metacharacters so a scope value can't distort the pattern below. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * owner_locations has no dedicated state column — the directory stores one
 * combined address string. This mirrors parseUsAddressTail's "City ST 12345"
 * tail shape as a Postgres ARE (~* is case-insensitive) so the state-scope
 * filter can run in SQL instead of after an unbounded fetch.
 */
function stateAddressTailPattern(state: string): string {
  return `,\\s*[^,]+\\s+${escapeRegExp(state)}\\s+\\d{5}(-\\d{4})?\\s*$`
}

// Only geocoded owner_locations rows, scoped by bounding box (when a full
// center+radius is set) and by state (when set) — both pushed into SQL so an
// out-of-scope /browse render never pulls the full table. A failed read
// throws (network/connection error); unstable_cache only persists a
// *resolved* value, so a failure can never poison the cache — the next
// request just retries uncached. A legitimately empty result set still
// resolves and is cached normally.
const cachedUnlistedOwnerLocationRows = unstable_cache(
  async (
    latMin: number | null,
    latMax: number | null,
    lngMin: number | null,
    lngMax: number | null,
    statesKey: string
  ) => {
    const conds = [isNotNull(ownerLocations.latitude), isNotNull(ownerLocations.longitude)]
    if (latMin != null && latMax != null && lngMin != null && lngMax != null) {
      conds.push(
        gte(ownerLocations.latitude, latMin),
        lte(ownerLocations.latitude, latMax),
        gte(ownerLocations.longitude, lngMin),
        lte(ownerLocations.longitude, lngMax)
      )
    }
    if (statesKey) {
      const stateConds = statesKey
        .split(",")
        .map((s) => sql`${ownerLocations.locationAddress} ~* ${stateAddressTailPattern(s)}`)
      const combined = or(...stateConds)
      if (combined) conds.push(combined)
    }

    // Explicit non-PII projection (DEBT-024): select ONLY the columns the
    // filter helpers and dedupe/return path consume. Excludes owner PII
    // (ownerName, ownerContactEmail, ownerContactEmailNormalized) and other
    // unused columns so they are never loaded into server memory.
    return db
      .select({
        id: ownerLocations.id,
        blvdLocationName: ownerLocations.blvdLocationName,
        blvdLocationNumber: ownerLocations.blvdLocationNumber,
        locationAddress: ownerLocations.locationAddress,
        resolvedBqLocationName: ownerLocations.resolvedBqLocationName,
        latitude: ownerLocations.latitude,
        longitude: ownerLocations.longitude,
        actualSuiteGoDate: ownerLocations.actualSuiteGoDate,
        suiteClosedDate: ownerLocations.suiteClosedDate,
        actualFlagshipGoDate: ownerLocations.actualFlagshipGoDate,
        flagshipClosedDate: ownerLocations.flagshipClosedDate,
      })
      .from(ownerLocations)
      .where(and(...conds))
  },
  ["hs-locations-unlisted-owner-rows"],
  { revalidate: 300, tags: ["hs-locations-unlisted"] } // 5 min — same rationale/shape as KPI cache
)

// BigQuery names of locations that are actively listed for sale — excluded
// from the map dots. Same throw-to-empty resilience as above: a failed read
// throws and is never cached, only a resolved (possibly empty) list is.
const cachedActiveListedBqNames = unstable_cache(
  async () => {
    const listed = await db
      .select({ bqLocationName: listingLocations.bqLocationName })
      .from(listingLocations)
      .innerJoin(listings, eq(listingLocations.listingId, listings.id))
      .where(and(eq(listings.status, "active"), isNotNull(listingLocations.bqLocationName)))
    return listed.map((l) => l.bqLocationName).filter((n): n is string => n != null)
  },
  ["hs-locations-active-listed-bq-names"],
  { revalidate: 300, tags: ["hs-locations-unlisted"] }
)

/**
 * READ-ONLY: open Hello Sugar locations that are NOT currently listed for sale,
 * for the /browse map dots. Only geocoded rows are returned. Resilient by
 * design — returns [] if anything fails, so it never blocks the page.
 */
export async function getUnlistedHsLocations(
  scope?: CompetitorScope
): Promise<UnlistedHsLocation[]> {
  try {
    // Bounding-box prefilter (uses the index) when a full center+radius scope
    // is set; state-scope key (sorted/deduped so the cache key is stable
    // regardless of filter-UI ordering).
    let box: { latMin: number; latMax: number; lngMin: number; lngMax: number } | null = null
    if (
      scope?.centerLat != null &&
      scope.centerLng != null &&
      scope.radiusMiles != null
    ) {
      box = boundingBox(scope.centerLat, scope.centerLng, scope.radiusMiles)
    }
    const statesKey =
      scope?.states && scope.states.length > 0
        ? Array.from(new Set(scope.states.map((s) => s.toUpperCase()))).sort().join(",")
        : ""

    const rows = await cachedUnlistedOwnerLocationRows(
      box?.latMin ?? null,
      box?.latMax ?? null,
      box?.lngMin ?? null,
      box?.lngMax ?? null,
      statesKey
    )

    const activeListedBqNames = new Set(await cachedActiveListedBqNames())

    const now = new Date()
    const seen = new Set<string>()
    const out: UnlistedHsLocation[] = []

    for (const r of rows) {
      if (r.latitude == null || r.longitude == null) continue
      if (!isLocationOpen(r, now)) continue
      if (!isNotListed(r.resolvedBqLocationName, activeListedBqNames)) continue

      const key = locationDedupeKey(r)
      if (seen.has(key)) continue

      const tail = r.locationAddress ? parseUsAddressTail(r.locationAddress) : null
      const loc: UnlistedHsLocation = {
        id: r.id,
        name: r.blvdLocationName,
        city: tail?.city ?? null,
        state: tail?.state ?? null,
        latitude: r.latitude,
        longitude: r.longitude,
        openedSince: openedSinceYear(r),
      }
      if (scope && !hsLocationInScope(loc, scope)) continue

      seen.add(key)
      out.push(loc)
    }

    return out
  } catch (err) {
    console.error("getUnlistedHsLocations failed; rendering map without HS location pins", err)
    return []
  }
}
