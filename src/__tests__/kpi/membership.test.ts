import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getMcrByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({ getMcrByLocation, getNetSalesByLocation: vi.fn() }))

describe("fetchLocationMembership", () => {
  beforeEach(() => { vi.resetModules(); getMcrByLocation.mockReset() })

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

  it("returns bigquery-sourced MCR metric when connected", async () => {
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 38]]))
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.lastMonth).toBe(38)
    expect(r?.source).toBe("bigquery")
    expect(r?.trend).toEqual([{ month: "TTM", value: 38 }])
  })

  it("returns null when location absent from the BigQuery map", async () => {
    getMcrByLocation.mockResolvedValue(new Map())
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Nowhere" })
    expect(r).toBeNull()
  })
})
