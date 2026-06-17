import "server-only"
import { unstable_cache } from "next/cache"
import { kpiResponseSchema, type KpiData, type KpiMetric } from "./schema"
import { mockLocationKpi, generateMockBundleKpi } from "./mock-data"
import { fetchMonthlySales, fetchMonthlyMembership } from "@/lib/boulevard/client"
import { canFetchBoulevard } from "./access"

/**
 * Check if we should use mock data (dev mode without API credentials).
 */
function shouldUseMockData(): boolean {
  const baseUrl = process.env.HS_INTERNAL_API_URL
  const token = process.env.HS_INTERNAL_API_TOKEN
  return !baseUrl || !token
}

/**
 * Internal fetch function (uncached).
 */
async function fetchLocationKpiInternal(locationId: string): Promise<KpiData | null> {
  // Return mock data when API credentials aren't configured
  if (shouldUseMockData()) {
    console.info("[KPI] Using mock data (API credentials not configured)")
    return mockLocationKpi
  }

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

/**
 * Fetch KPI data for a single location with 5-minute server cache.
 * Returns mock data in development when API credentials aren't configured.
 * Returns null on any error (network, non-200, validation) for graceful degradation.
 */
export const fetchLocationKpi = unstable_cache(
  fetchLocationKpiInternal,
  ["kpi-location"],
  { revalidate: 300 } // 5 min cache
)

/**
 * Fetch KPI data for multiple locations (bundle).
 * Returns mock data in development when API credentials aren't configured.
 * Returns object mapping locationId -> KpiData, excluding failed fetches.
 */
export async function fetchBundleKpi(locationIds: string[]): Promise<Record<string, KpiData>> {
  // Return mock bundle data when API credentials aren't configured
  if (shouldUseMockData()) {
    console.info("[KPI] Using mock bundle data (API credentials not configured)")
    return generateMockBundleKpi(locationIds)
  }

  const results = await Promise.all(
    locationIds.map(async (id) => {
      const data = await fetchLocationKpi(id)
      return { id, data }
    })
  )

  const bundle: Record<string, KpiData> = {}
  for (const { id, data } of results) {
    if (data !== null) {
      bundle[id] = data
    }
  }

  return bundle
}

// Daily-cached monthly sales, keyed by boulevard location id (don't hit the API per view).
const cachedMonthlySales = unstable_cache(
  async (boulevardLocationId: string) => fetchMonthlySales(boulevardLocationId, 12),
  ["boulevard-monthly-sales"],
  { revalidate: 86400, tags: ["boulevard-revenue"] }
)

// Daily-cached monthly membership rates, keyed by boulevard location id.
const cachedMonthlyMembership = unstable_cache(
  async (boulevardLocationId: string) => fetchMonthlyMembership(boulevardLocationId, 12),
  ["boulevard-monthly-membership"],
  { revalidate: 86400, tags: ["boulevard-membership"] }
)

export async function fetchLocationMembership(args: {
  listingStatus: string
  mappingStatus: string
  boulevardLocationId: string | null
}): Promise<KpiMetric | null> {
  if (!args.boulevardLocationId || !canFetchBoulevard(args.listingStatus, args.mappingStatus)) {
    return null
  }
  const series = await cachedMonthlyMembership(args.boulevardLocationId)
  if (!series || series.length === 0) return null
  const last = series[series.length - 1].rate
  const prev = series.length > 1 ? series[series.length - 2].rate : last
  const momChange = prev > 0 ? (last - prev) / prev : 0
  return {
    lastMonth: last,
    momChange,
    trend: series.map((m) => ({ month: m.month, value: m.rate })),
    updatedAt: new Date().toISOString(),
    source: "boulevard",
  }
}

export async function fetchLocationRevenue(args: {
  listingStatus: string
  mappingStatus: string
  boulevardLocationId: string | null
}): Promise<{ metric: KpiMetric; ttmCents: number } | null> {
  if (!args.boulevardLocationId || !canFetchBoulevard(args.listingStatus, args.mappingStatus)) {
    return null // "not connected"
  }
  const series = await cachedMonthlySales(args.boulevardLocationId)
  if (!series || series.length === 0) return null
  const ttmCents = series.reduce((s, m) => s + m.sales, 0)
  const last = series[series.length - 1].sales
  const prev = series.length > 1 ? series[series.length - 2].sales : last
  const momChange = prev > 0 ? (last - prev) / prev : 0
  return {
    ttmCents,
    metric: {
      lastMonth: last,
      momChange,
      trend: series.map((m) => ({ month: m.month, value: m.sales })),
      updatedAt: new Date().toISOString(),
      source: "boulevard",
    },
  }
}
