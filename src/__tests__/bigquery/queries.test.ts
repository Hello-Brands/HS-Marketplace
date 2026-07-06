import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

// Pass-through unstable_cache so we exercise the cached callback + wrapper
// directly. Because it does NOT persist results, calling a wrapper twice re-runs
// the callback each time — which is exactly what we need to prove a prior
// failure does not poison a subsequent call.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }))

// Mock the BigQuery client so we control runQuery's null (failure) vs [] (empty).
// vi.hoisted so the fn exists when the hoisted vi.mock factory runs.
const { runQuery } = vi.hoisted(() => ({ runQuery: vi.fn() }))
vi.mock("@/lib/bigquery/client", () => ({ runQuery }))

import {
  rowsToNetSalesByLocation,
  rowsToMcrMap,
  rowsToMcrTrendByLocation,
  getNetSalesByLocation,
  getMcrByLocation,
  getMcrTrendByLocation,
  getReviewSummaryByLocation,
} from "@/lib/bigquery/queries"

describe("rowsToNetSalesByLocation", () => {
  it("sums monthly dollars into cents and keeps a sorted dollar trend", () => {
    const map = rowsToNetSalesByLocation([
      { LOCATION_NAME: "Sugar House", sales_month: "2025-08", cash_plus_credit: 100.50 },
      { LOCATION_NAME: "Sugar House", sales_month: "2025-07", cash_plus_credit: 200 },
      { LOCATION_NAME: "Sugar House", sales_month: "2025-09", cash_plus_credit: 50 },
    ])
    const sh = map.get("Sugar House")!
    expect(sh.totalCents).toBe(35050) // (200 + 100.50 + 50) * 100
    expect(sh.trend).toEqual([
      { month: "Jul 2025", value: 200 },
      { month: "Aug 2025", value: 100.5 },
      { month: "Sep 2025", value: 50 },
    ])
  })

  it("skips rows with null/blank location name", () => {
    const map = rowsToNetSalesByLocation([
      { LOCATION_NAME: null, sales_month: "2025-07", cash_plus_credit: 100 },
    ])
    expect(map.size).toBe(0)
  })

  it("skips rows with null sales_month", () => {
    const map = rowsToNetSalesByLocation([
      { LOCATION_NAME: "X", sales_month: null, cash_plus_credit: 100 },
    ])
    expect(map.size).toBe(0)
  })

  it("coerces string / Big-like numeric values (NUMERIC columns)", () => {
    const map = rowsToNetSalesByLocation([
      { LOCATION_NAME: "Str", sales_month: "2025-07", cash_plus_credit: "168000.55" },
      { LOCATION_NAME: "Big", sales_month: "2025-08", cash_plus_credit: { toString: () => "4200.00" } },
    ])
    expect(map.get("Str")!.totalCents).toBe(16800055)
    expect(map.get("Big")!.totalCents).toBe(420000)
  })
})

describe("rowsToMcrMap", () => {
  it("maps mcr_pct as a number keyed by LOCATION_NAME", () => {
    const map = rowsToMcrMap([{ LOCATION_NAME: "Sugar House", mcr_pct: 38 }])
    expect(map.get("Sugar House")).toBe(38)
  })

  it("treats null mcr_pct as 0", () => {
    const map = rowsToMcrMap([{ LOCATION_NAME: "X", mcr_pct: null }])
    expect(map.get("X")).toBe(0)
  })
})

describe("rowsToMcrTrendByLocation", () => {
  it("sorts months chronologically with friendly labels", () => {
    const map = rowsToMcrTrendByLocation([
      { LOCATION_NAME: "SH", mcr_month: "2025-08", mcr_pct: 37.3 },
      { LOCATION_NAME: "SH", mcr_month: "2025-07", mcr_pct: 42.3 },
      { LOCATION_NAME: "SH", mcr_month: "2025-09", mcr_pct: 28.2 },
    ])
    expect(map.get("SH")).toEqual([
      { month: "Jul 2025", value: 42.3 },
      { month: "Aug 2025", value: 37.3 },
      { month: "Sep 2025", value: 28.2 },
    ])
  })

  it("drops zero-prospect months (null mcr_pct) but keeps a legitimate 0%", () => {
    const map = rowsToMcrTrendByLocation([
      { LOCATION_NAME: "SH", mcr_month: "2025-07", mcr_pct: null },
      { LOCATION_NAME: "SH", mcr_month: "2025-08", mcr_pct: 0 },
    ])
    expect(map.get("SH")).toEqual([{ month: "Aug 2025", value: 0 }])
  })

  it("skips rows with null location name or null month", () => {
    const map = rowsToMcrTrendByLocation([
      { LOCATION_NAME: null, mcr_month: "2025-07", mcr_pct: 30 },
      { LOCATION_NAME: "SH", mcr_month: null, mcr_pct: 30 },
    ])
    expect(map.size).toBe(0)
  })
})

// DEBT-005: a query FAILURE (runQuery -> null) must not be cached, so it can't
// poison the KPI/review cards for the full 24h revalidate window. Distinguished
// from a legitimately EMPTY result set (runQuery -> []), which may be cached.
describe("cached BQ fetchers: failure vs empty (DEBT-005)", () => {
  beforeEach(() => {
    runQuery.mockReset()
  })

  it("getNetSalesByLocation: a failed query does not poison the next call", async () => {
    // First call: creds/query failure -> null. Returns the empty-map sentinel...
    runQuery.mockResolvedValueOnce(null)
    const failed = await getNetSalesByLocation()
    expect(failed).toBeInstanceOf(Map)
    expect(failed.size).toBe(0)

    // ...and because the failure threw (uncached), the very next call re-queries
    // and returns real data rather than a poisoned empty map.
    runQuery.mockResolvedValueOnce([
      { LOCATION_NAME: "Sugar House", sales_month: "2025-07", cash_plus_credit: 100 },
    ])
    const ok = await getNetSalesByLocation()
    expect(ok.get("Sugar House")?.totalCents).toBe(10000)
  })

  it("getNetSalesByLocation: a successful empty result still returns an empty map", async () => {
    runQuery.mockResolvedValueOnce([])
    const map = await getNetSalesByLocation()
    expect(map).toBeInstanceOf(Map)
    expect(map.size).toBe(0)
  })

  it("getMcrByLocation: failure -> empty-map sentinel, then recovers", async () => {
    runQuery.mockResolvedValueOnce(null)
    expect((await getMcrByLocation()).size).toBe(0)
    runQuery.mockResolvedValueOnce([{ LOCATION_NAME: "SH", mcr_pct: 38 }])
    expect((await getMcrByLocation()).get("SH")).toBe(38)
  })

  it("getMcrByLocation: successful empty result returns empty map", async () => {
    runQuery.mockResolvedValueOnce([])
    expect((await getMcrByLocation()).size).toBe(0)
  })

  it("getMcrTrendByLocation: failure -> empty-map sentinel, then recovers", async () => {
    runQuery.mockResolvedValueOnce(null)
    expect((await getMcrTrendByLocation()).size).toBe(0)
    runQuery.mockResolvedValueOnce([{ LOCATION_NAME: "SH", mcr_month: "2025-07", mcr_pct: 40 }])
    expect((await getMcrTrendByLocation()).get("SH")).toEqual([{ month: "Jul 2025", value: 40 }])
  })

  it("getReviewSummaryByLocation: failure -> empty-map sentinel; empty result -> empty map", async () => {
    runQuery.mockResolvedValueOnce(null)
    expect((await getReviewSummaryByLocation()).size).toBe(0)
    runQuery.mockResolvedValueOnce([])
    expect((await getReviewSummaryByLocation()).size).toBe(0)
  })

  it("public contract unchanged: wrappers always resolve to a Map", async () => {
    runQuery.mockResolvedValue([])
    expect(await getNetSalesByLocation()).toBeInstanceOf(Map)
    expect(await getMcrByLocation()).toBeInstanceOf(Map)
    expect(await getMcrTrendByLocation()).toBeInstanceOf(Map)
    expect(await getReviewSummaryByLocation()).toBeInstanceOf(Map)
  })
})
