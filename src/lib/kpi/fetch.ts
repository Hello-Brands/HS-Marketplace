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
import { canFetchLiveData } from "./access"
import type { BundleLocationKpi } from "./bundle"

/**
 * Check if we should use mock data (dev mode without API credentials).
 */
function shouldUseMockData(): boolean {
  const baseUrl = process.env.HS_INTERNAL_API_URL
  const token = process.env.HS_INTERNAL_API_TOKEN
  return !baseUrl || !token
}

/**
 * Live fetch against the internal API (uncached). Returns null on any failure
 * (network, non-200, validation). The mock-data path is handled by the public
 * wrapper BEFORE the cache, so mock responses can never be cached as if real.
 */
async function fetchLocationKpiLive(locationId: string): Promise<KpiData | null> {
  try {
    const baseUrl = process.env.HS_INTERNAL_API_URL
    const token = process.env.HS_INTERNAL_API_TOKEN

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
  const last = points.length > 0 ? points[points.length - 1].value : pct
  const prior = points.length > 1 ? points[points.length - 2].value : 0
  const momChange = points.length > 1 && prior !== 0 ? (last - prior) / prior : 0

  return {
    lastMonth: last,
    momChange,
    trend,
    updatedAt: new Date().toISOString(),
    source: "bigquery",
  }
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
  const trend = ns.trend
  const last = trend.length > 0 ? trend[trend.length - 1].value : 0
  const prior = trend.length > 1 ? trend[trend.length - 2].value : 0
  const momChange = prior !== 0 ? (last - prior) / prior : 0

  return {
    totalCents: ns.totalCents,
    metric: {
      lastMonth: ns.totalCents / 100, // TTM total in dollars
      momChange,
      trend,
      updatedAt: new Date().toISOString(),
      source: "bigquery",
    },
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
        const trend = ns.trend
        const last = trend.length > 0 ? trend[trend.length - 1].value : 0
        const prior = trend.length > 1 ? trend[trend.length - 2].value : 0
        netSales = {
          lastMonth: ns.totalCents / 100,
          momChange: prior !== 0 ? (last - prior) / prior : 0,
          trend,
          updatedAt: new Date().toISOString(),
          source: "bigquery",
        }
      }

      const pct = mcrMap.get(loc.bqLocationName)
      if (pct !== undefined) {
        const points = mcrTrendMap.get(loc.bqLocationName) ?? []
        const trend = points.length > 0 ? points : [{ month: "TTM", value: pct }]
        const last = points.length > 0 ? points[points.length - 1].value : pct
        const prior = points.length > 1 ? points[points.length - 2].value : 0
        membership = {
          lastMonth: last,
          momChange: points.length > 1 && prior !== 0 ? (last - prior) / prior : 0,
          trend,
          updatedAt: new Date().toISOString(),
          source: "bigquery",
        }
      }
    }

    return { id: loc.id, name: loc.name, netSales, membership }
  })
}
