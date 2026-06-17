import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, cacheLife: vi.fn() }))
vi.mock("@/lib/boulevard/client", () => ({ fetchMonthlySales: vi.fn() }))

describe("fetchLocationRevenue", () => {
  beforeEach(() => vi.resetModules())

  it("returns null (not connected) when mapping is not confirmed", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "unconfirmed", boulevardLocationId: "b1" })
    expect(r).toBeNull()
  })

  it("returns null when there is no boulevard id", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", boulevardLocationId: null })
    expect(r).toBeNull()
  })

  it("builds a revenue metric + TTM from Boulevard monthly sales", async () => {
    const { fetchMonthlySales } = await import("@/lib/boulevard/client")
    vi.mocked(fetchMonthlySales).mockResolvedValue([
      { month: "2026-04", sales: 1000000 },
      { month: "2026-05", sales: 1200000 },
    ])
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", boulevardLocationId: "b1" })
    expect(r?.ttmCents).toBe(2200000)
    expect(r?.metric.lastMonth).toBe(1200000)
    expect(r?.metric.source).toBe("boulevard")
    expect(r?.metric.trend).toEqual([
      { month: "2026-04", value: 1000000 },
      { month: "2026-05", value: 1200000 },
    ])
  })
})
