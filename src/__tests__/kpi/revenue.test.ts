import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getNetSalesByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({ getNetSalesByLocation, getMcrByLocation: vi.fn() }))

describe("fetchLocationRevenue", () => {
  beforeEach(() => { vi.resetModules(); getNetSalesByLocation.mockReset() })

  it("returns null when not active+confirmed", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "draft", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r).toBeNull()
  })

  it("returns null when location name missing", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: null })
    expect(r).toBeNull()
  })

  it("returns total cents + dollars metric with real trend and MoM when connected", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map([["Sugar House", {
      totalCents: 35000,
      trend: [
        { month: "2025-07", value: 100 },
        { month: "2025-08", value: 100 },
        { month: "2025-09", value: 150 },
      ],
    }]]))
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.totalCents).toBe(35000)
    expect(r?.metric.source).toBe("bigquery")
    expect(r?.metric.lastMonth).toBe(350)         // 35000 cents -> 350 dollars
    expect(r?.metric.trend).toHaveLength(3)
    expect(r?.metric.momChange).toBeCloseTo(0.5)  // (150 - 100) / 100
  })

  it("returns null when location absent from the BigQuery map", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map())
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Nowhere" })
    expect(r).toBeNull()
  })
})
