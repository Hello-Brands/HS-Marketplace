import { db } from "@/db"
import { ownerLocations } from "@/db/schema"
import { listings, listingLocations } from "@/db/schema/listings"
import { and, eq, gte, lte, isNotNull } from "drizzle-orm"
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

/**
 * READ-ONLY: open Hello Sugar locations that are NOT currently listed for sale,
 * for the /browse map dots. Only geocoded rows are returned. Resilient by
 * design — returns [] if anything fails, so it never blocks the page.
 */
export async function getUnlistedHsLocations(
  scope?: CompetitorScope
): Promise<UnlistedHsLocation[]> {
  try {
    // Only geocoded rows; bounding-box prefilter (uses the index) when a full
    // center+radius scope is set.
    const conds = [isNotNull(ownerLocations.latitude), isNotNull(ownerLocations.longitude)]
    if (
      scope?.centerLat != null &&
      scope.centerLng != null &&
      scope.radiusMiles != null
    ) {
      const box = boundingBox(scope.centerLat, scope.centerLng, scope.radiusMiles)
      conds.push(
        gte(ownerLocations.latitude, box.latMin),
        lte(ownerLocations.latitude, box.latMax),
        gte(ownerLocations.longitude, box.lngMin),
        lte(ownerLocations.longitude, box.lngMax)
      )
    }

    // Explicit non-PII projection (DEBT-024): select ONLY the columns the
    // filter helpers and dedupe/return path consume. Excludes owner PII
    // (ownerName, ownerContactEmail, ownerContactEmailNormalized) and other
    // unused columns so they are never loaded into server memory.
    const rows = await db
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

    // BigQuery names of locations that are actively listed for sale — excluded.
    const listed = await db
      .select({ bqLocationName: listingLocations.bqLocationName })
      .from(listingLocations)
      .innerJoin(listings, eq(listingLocations.listingId, listings.id))
      .where(and(eq(listings.status, "active"), isNotNull(listingLocations.bqLocationName)))
    const activeListedBqNames = new Set(
      listed.map((l) => l.bqLocationName).filter((n): n is string => n != null)
    )

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
