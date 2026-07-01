import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getMcrByLocation = vi.fn()
const getMcrTrendByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({
  getMcrByLocation,
  getMcrTrendByLocation,
  getNetSalesByLocation: vi.fn(),
}))

describe("fetchLocationMembership", () => {
  beforeEach(() => {
    vi.resetModules()
    getMcrByLocation.mockReset()
    getMcrTrendByLocation.mockReset()
  })

  it("returns null when not active+confirmed", async () => {
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "draft", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r).toBeNull()
  })

  it("returns null when location name missing", async () => {
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: null })
    expect(r).toBeNull()
  })

  it("uses the most recent month as the headline + monthly trend + real MoM when connected", async () => {
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))
    getMcrTrendByLocation.mockResolvedValue(new Map([["Sugar House", [
      { month: "Apr 2026", value: 32.6 },
      { month: "May 2026", value: 40.4 },
    ]]]))
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.lastMonth).toBe(40.4) // latest month, NOT the pooled TTM
    expect(r?.source).toBe("bigquery")
    expect(r?.trend).toEqual([
      { month: "Apr 2026", value: 32.6 },
      { month: "May 2026", value: 40.4 },
    ])
    expect(r?.momChange).toBeCloseTo((40.4 - 32.6) / 32.6)
  })

  it("falls back to a single TTM point when no monthly trend exists", async () => {
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))
    getMcrTrendByLocation.mockResolvedValue(new Map())
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.lastMonth).toBe(34.5)
    expect(r?.trend).toEqual([{ month: "TTM", value: 34.5 }])
    expect(r?.momChange).toBe(0)
  })

  it("returns null when location absent from the pooled BigQuery map", async () => {
    getMcrByLocation.mockResolvedValue(new Map())
    getMcrTrendByLocation.mockResolvedValue(new Map())
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Nowhere" })
    expect(r).toBeNull()
  })
})
