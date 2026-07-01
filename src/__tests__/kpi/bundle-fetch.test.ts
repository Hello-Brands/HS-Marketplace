import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getNetSalesByLocation = vi.fn()
const getMcrByLocation = vi.fn()
const getMcrTrendByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({
  getNetSalesByLocation,
  getMcrByLocation,
  getMcrTrendByLocation,
}))

const LOCS = [
  { id: "1", name: "Buckhead", bqLocationName: "Buckhead", dataMappingStatus: "confirmed" },
  { id: "2", name: "Midtown", bqLocationName: "Midtown", dataMappingStatus: "confirmed" },
]

describe("fetchBundleLocationKpis", () => {
  beforeEach(() => {
    vi.resetModules()
    getNetSalesByLocation.mockReset(); getMcrByLocation.mockReset(); getMcrTrendByLocation.mockReset()
  })

  it("returns null metrics for every location when listing is not active", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map())
    getMcrByLocation.mockResolvedValue(new Map())
    getMcrTrendByLocation.mockResolvedValue(new Map())
    const { fetchBundleLocationKpis } = await import("@/lib/kpi/fetch")
    const res = await fetchBundleLocationKpis(LOCS, "draft")
    expect(res).toHaveLength(2)
    expect(res.every(r => r.netSales === null && r.membership === null)).toBe(true)
  })

  it("populates metrics from the maps for connected locations", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map([
      ["Buckhead", { totalCents: 100000, trend: [{ month: "Jan", value: 400 }, { month: "Feb", value: 600 }] }],
    ]))
    getMcrByLocation.mockResolvedValue(new Map([["Buckhead", 32]]))
    getMcrTrendByLocation.mockResolvedValue(new Map([["Buckhead", [{ month: "Jan", value: 30 }, { month: "Feb", value: 34 }]]]))
    const { fetchBundleLocationKpis } = await import("@/lib/kpi/fetch")
    const res = await fetchBundleLocationKpis(LOCS, "active")
    const buckhead = res.find(r => r.id === "1")!
    const midtown = res.find(r => r.id === "2")!
    expect(buckhead.netSales?.lastMonth).toBe(1000)   // 100000 cents -> 1000 dollars
    expect(buckhead.netSales?.source).toBe("bigquery")
    expect(buckhead.membership?.lastMonth).toBe(34) // latest month, not pooled TTM (32)
    expect(midtown.netSales).toBeNull()               // absent from maps
    expect(midtown.membership).toBeNull()
  })

  it("treats a missing bqLocationName as not connected", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map([["Buckhead", { totalCents: 1, trend: [] }]]))
    getMcrByLocation.mockResolvedValue(new Map([["Buckhead", 10]]))
    getMcrTrendByLocation.mockResolvedValue(new Map())
    const { fetchBundleLocationKpis } = await import("@/lib/kpi/fetch")
    const res = await fetchBundleLocationKpis(
      [{ id: "9", name: "No BQ", bqLocationName: null, dataMappingStatus: "confirmed" }],
      "active",
    )
    expect(res[0].netSales).toBeNull()
    expect(res[0].membership).toBeNull()
  })
})
