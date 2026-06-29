import { db } from "@/db"
import { competitorOpportunities } from "@/db/schema/competitorOpportunities"
import { and, gte, lte } from "drizzle-orm"
import { boundingBox } from "./geo"
import { filterCompetitorsByScope, type CompetitorScope } from "./competitor-filter"

/**
 * READ-ONLY access to the scraper-owned `competitor_opportunities` table.
 *
 * This module is imported only by server components (the /browse page). It never
 * writes — the external competitor-monitor scraper owns every row. See the
 * schema file header for the ownership contract.
 */

export interface CompetitorClosure {
  googlePlaceId: string
  brandId: string
  brandName: string
  address: string
  city: string
  state: string
  latitude: number
  longitude: number
  businessStatus: string // 'CLOSED_PERMANENTLY' | 'CLOSED_TEMPORARILY'
  closedAt: string | null // ISO string (when first detected closed)
  nearestHsName: string | null
  nearestHsMiles: number | null
  isOpportunity: boolean
  mapsUrl: string | null
}

/**
 * Fetch competitor closures, optionally narrowed to a scope (radius/center +
 * states). When a full center+radius is set we prefilter with a bounding box
 * (uses the geo index), then apply the precise scope filter in JS — the closure
 * set is small. With no scope, returns all rows (the default browse view).
 *
 * Resilient by design: returns [] if the scraper table is empty/unavailable.
 */
export async function getCompetitorClosures(
  scope?: CompetitorScope
): Promise<CompetitorClosure[]> {
  try {
    let where = undefined
    if (
      scope?.centerLat != null &&
      scope.centerLng != null &&
      scope.radiusMiles != null
    ) {
      const box = boundingBox(scope.centerLat, scope.centerLng, scope.radiusMiles)
      where = and(
        gte(competitorOpportunities.lat, String(box.latMin)),
        lte(competitorOpportunities.lat, String(box.latMax)),
        gte(competitorOpportunities.lng, String(box.lngMin)),
        lte(competitorOpportunities.lng, String(box.lngMax))
      )
    }

    const rows = await db.select().from(competitorOpportunities).where(where)

    const mapped: CompetitorClosure[] = rows.map((r) => ({
      googlePlaceId: r.googlePlaceId,
      brandId: r.brandId,
      brandName: r.brandName,
      address: r.address,
      city: r.city,
      state: r.state,
      latitude: Number(r.lat),
      longitude: Number(r.lng),
      businessStatus: r.businessStatus,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      nearestHsName: r.nearestHsName,
      nearestHsMiles: r.nearestHsMiles != null ? Number(r.nearestHsMiles) : null,
      isOpportunity: r.isOpportunity,
      mapsUrl: r.mapsUrl,
    }))

    return scope ? filterCompetitorsByScope(mapped, scope) : mapped
  } catch (err) {
    console.error(
      "getCompetitorClosures failed; rendering map without competitor pins",
      err
    )
    return []
  }
}
