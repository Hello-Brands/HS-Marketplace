import "server-only"
import { unstable_cache } from "next/cache"
import { kpiResponseSchema, type KpiData, type KpiMetric } from "./schema"
import { mockLocationKpi } from "./mock-data"
import {
  getNetSalesByLocation,
  getMcrByLocation,
  getMcrTrendByLocation,
  getReviewSummaryByLocation,
  type LocationReviewSummary,
} from "@/lib/bigquery/queries"
import { canFetchLiveData, canOwnerFetchLiveData } from "./access"
import { buildMetricFromTrend } from "./metric"
import type { BundleLocationKpi } from "./bundle"
import { env } from "@/lib/env"

/**
 * Check if we should use mock data (dev mode without API credentials).
 */
function shouldUseMockData(): boolean {
  const baseUrl = env.HS_INTERNAL_API_URL
  const token = env.HS_INTERNAL_API_TOKEN
  return !baseUrl || !token
}

/**
 * Live fetch against the internal API (uncached). Returns null on any failure
 * (network, non-200, validation). The mock-data path is handled by the public
 * wrapper BEFORE the cache, so mock responses can never be cached as if real.
 */
async function fetchLocationKpiLive(locationId: string): Promise<KpiData | null> {
  try {
    const baseUrl = env.HS_INTERNAL_API_URL
    const token = env.HS_INTERNAL_API_TOKEN

    if (!baseUrl || !token) {
      return null
    }

    const res = await fetch(`${baseUrl}/locations/${locationId}/kpi`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    })

    if (!res.ok) {
      console.warn(`[KPI] API returned ${res.status} for location ${locationId}`)
      return null
    }

    const raw = await res.json()
    const parsed = kpiResponseSchema.safeParse(raw)

    if (!parsed.success) {
      console.warn(`[KPI] Validation failed for location ${locationId}:`, parsed.error.issues)
      return null
    }

    return parsed.data
  } catch (error) {
    console.warn(`[KPI] Fetch failed for location ${locationId}:`, error)
    return null
  }
}

// Only the live path is cached. Throwing on failure means unstable_cache does
// NOT persist the null — a transient API outage can't blank the KPI for 5 min;
// the next request retries.
const cachedFetchLocationKpiLive = unstable_cache(
  async (locationId: string): Promise<KpiData> => {
    const data = await fetchLocationKpiLive(locationId)
    if (data === null) throw new Error("[KPI] live fetch failed — not caching")
    return data
  },
  ["kpi-location"],
  { revalidate: 300 } // 5 min cache
)

/**
 * Fetch KPI data for a single location with 5-minute server cache.
 * Returns mock data in development when API credentials aren't configured (never
 * cached — decided before the cache wrapper so mock data can't be served as real).
 * Returns null on any error (network, non-200, validation) for graceful degradation.
 */
export async function fetchLocationKpi(locationId: string): Promise<KpiData | null> {
  if (shouldUseMockData()) {
    console.info("[KPI] Using mock data (API credentials not configured)")
    return mockLocationKpi
  }
  try {
    return await cachedFetchLocationKpiLive(locationId)
  } catch {
    return null // failure sentinel: same null callers see today, but uncached
  }
}

export async function fetchLocationMembership(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<KpiMetric | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null
  }
  const [pooledMap, trendMap] = await Promise.all([getMcrByLocation(), getMcrTrendByLocation()])
  const pct = pooledMap.get(args.bqLocationName)
  if (pct === undefined) return null // headline drives connectivity

  // Headline shows the most recent month's MCR; the monthly series feeds the
  // trend. Falls back to the pooled TTM ratio when no monthly series exists.
  const points = trendMap.get(args.bqLocationName) ?? []
  const trend = points.length > 0 ? points : [{ month: "TTM", value: pct }]

  return buildMetricFromTrend(trend)
}

export async function fetchLocationRevenue(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<{ metric: KpiMetric; totalCents: number } | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null // "not connected"
  }
  const map = await getNetSalesByLocation()
  const ns = map.get(args.bqLocationName)
  if (ns === undefined) return null

  // KpiCard/KpiTrendChart format values as dollars; the financials card uses cents.
  // Headline is the TTM total in dollars; the trend drives the sparkline.
  return {
    totalCents: ns.totalCents,
    metric: buildMetricFromTrend(ns.trend, { lastMonth: ns.totalCents / 100 }),
  }
}

export async function fetchLocationReviews(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<LocationReviewSummary | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null // "not connected"
  }
  const map = await getReviewSummaryByLocation()
  return map.get(args.bqLocationName) ?? null
}

/**
 * Fetch real BigQuery Net Sales + MCR per bundle location. Loads the cached
 * maps once and looks up each location by bqLocationName (gated like single
 * listings). Locations that are not connected / absent return null metrics but
 * are still included so the caller can list them.
 */
export async function fetchBundleLocationKpis(
  locations: { id: string; name: string; bqLocationName: string | null; dataMappingStatus: string }[],
  listingStatus: string,
): Promise<BundleLocationKpi[]> {
  const [netMap, mcrMap, mcrTrendMap] = await Promise.all([
    getNetSalesByLocation(),
    getMcrByLocation(),
    getMcrTrendByLocation(),
  ])

  return locations.map((loc) => {
    const connected = !!loc.bqLocationName && canFetchLiveData(listingStatus, loc.dataMappingStatus)
    let netSales: KpiMetric | null = null
    let membership: KpiMetric | null = null

    if (connected && loc.bqLocationName) {
      const ns = netMap.get(loc.bqLocationName)
      if (ns) {
        netSales = buildMetricFromTrend(ns.trend, { lastMonth: ns.totalCents / 100 })
      }

      const pct = mcrMap.get(loc.bqLocationName)
      if (pct !== undefined) {
        const points = mcrTrendMap.get(loc.bqLocationName) ?? []
        const trend = points.length > 0 ? points : [{ month: "TTM", value: pct }]
        membership = buildMetricFromTrend(trend)
      }
    }

    return { id: loc.id, name: loc.name, netSales, membership }
  })
}

/**
 * Owner-scoped KPI fetch for /account/locations/[id] — the owner-gate
 * counterpart of the listing-gated fetchers above. The caller passes the
 * ownerIdentifier from a server-verified owner_locations row plus the
 * session's ownerIdentifier; anything short of an exact owner match with a
 * resolved BigQuery name returns all-null ("not connected" rendering).
 */
export async function fetchOwnerLocationKpis(args: {
  rowOwnerIdentifier: string
  sessionOwnerIdentifier: string | null
  bqLocationName: string | null
}): Promise<{
  netSales: KpiMetric | null
  membership: KpiMetric | null
  reviews: LocationReviewSummary | null
}> {
  if (
    !canOwnerFetchLiveData(
      args.rowOwnerIdentifier,
      args.sessionOwnerIdentifier,
      args.bqLocationName
    )
  ) {
    return { netSales: null, membership: null, reviews: null }
  }
  const bqName = args.bqLocationName as string

  const [netMap, mcrMap, mcrTrendMap, reviewMap] = await Promise.all([
    getNetSalesByLocation(),
    getMcrByLocation(),
    getMcrTrendByLocation(),
    getReviewSummaryByLocation(),
  ])

  const ns = netMap.get(bqName)
  const netSales = ns
    ? buildMetricFromTrend(ns.trend, { lastMonth: ns.totalCents / 100 })
    : null

  let membership: KpiMetric | null = null
  const pct = mcrMap.get(bqName)
  if (pct !== undefined) {
    const points = mcrTrendMap.get(bqName) ?? []
    const trend = points.length > 0 ? points : [{ month: "TTM", value: pct }]
    membership = buildMetricFromTrend(trend)
  }

  return { netSales, membership, reviews: reviewMap.get(bqName) ?? null }
}
