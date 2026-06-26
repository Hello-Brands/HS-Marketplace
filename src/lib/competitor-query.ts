import { db } from "@/db"
import { competitorOpportunities } from "@/db/schema/competitorOpportunities"
import { and, gte, lte } from "drizzle-orm"

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

/** Lat/lng window for an optional viewport-scoped fetch (uses the geo index). */
export interface ViewportBounds {
  latMin: number
  latMax: number
  lngMin: number
  lngMax: number
}

/**
 * Fetch competitor closures, optionally constrained to a map viewport (the
 * `(lat, lng)` index makes the bounded query cheap). Closures are an inherently
 * small set, so the unbounded call is also fine for the initial render.
 *
 * Resilient by design: if the scraper has not created/populated anything yet,
 * or the table is briefly mid-reconcile, we return [] so the map renders
 * normally with zero competitor pins rather than failing the page.
 */
export async function getCompetitorClosures(
  viewport?: ViewportBounds
): Promise<CompetitorClosure[]> {
  try {
    // numeric columns come back as strings from the driver — compare against
    // string bounds, then coerce to number for the client.
    const where = viewport
      ? and(
          gte(competitorOpportunities.lat, String(viewport.latMin)),
          lte(competitorOpportunities.lat, String(viewport.latMax)),
          gte(competitorOpportunities.lng, String(viewport.lngMin)),
          lte(competitorOpportunities.lng, String(viewport.lngMax))
        )
      : undefined

    const rows = await db
      .select()
      .from(competitorOpportunities)
      .where(where)

    return rows.map((r) => ({
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
  } catch (err) {
    console.error(
      "getCompetitorClosures failed; rendering map without competitor pins",
      err
    )
    return []
  }
}
