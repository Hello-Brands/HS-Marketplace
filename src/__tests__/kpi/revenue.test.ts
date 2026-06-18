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

  it("returns ytd cents + bigquery-sourced metric when connected", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map([["Sugar House", 16800055]]))
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.ytdCents).toBe(16800055)
    expect(r?.metric.source).toBe("bigquery")
    expect(r?.metric.lastMonth).toBe(16800055)
  })

  it("returns null when location absent from the BigQuery map", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map())
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Nowhere" })
    expect(r).toBeNull()
  })
})
