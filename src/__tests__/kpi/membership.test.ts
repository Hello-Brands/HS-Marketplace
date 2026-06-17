import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, cacheLife: vi.fn() }))
vi.mock("@/lib/boulevard/client", () => ({ fetchMonthlySales: vi.fn(), fetchMonthlyMembership: vi.fn() }))

describe("fetchLocationMembership", () => {
  beforeEach(() => vi.resetModules())

  it("returns null when mapping is not confirmed", async () => {
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    expect(await fetchLocationMembership({ listingStatus: "active", mappingStatus: "unconfirmed", boulevardLocationId: "b1" })).toBeNull()
  })

  it("builds a membership metric from monthly rates", async () => {
    const { fetchMonthlyMembership } = await import("@/lib/boulevard/client")
    vi.mocked(fetchMonthlyMembership).mockResolvedValue([
      { month: "2026-04", rate: 0.2 },
      { month: "2026-05", rate: 0.25 },
    ])
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", boulevardLocationId: "b1" })
    expect(r?.lastMonth).toBe(0.25)
    expect(r?.source).toBe("boulevard")
    expect(r?.trend).toEqual([{ month: "2026-04", value: 0.2 }, { month: "2026-05", value: 0.25 }])
  })
})
