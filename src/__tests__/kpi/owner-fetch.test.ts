import { describe, it, expect, vi, beforeEach } from "vitest"
import type { LocationReviewSummary } from "@/lib/bigquery/queries"

vi.mock("server-only", () => ({}))

const getNetSalesByLocation = vi.fn()
const getMcrByLocation = vi.fn()
const getMcrTrendByLocation = vi.fn()
const getReviewSummaryByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({
  getNetSalesByLocation,
  getMcrByLocation,
  getMcrTrendByLocation,
  getReviewSummaryByLocation,
}))

// LocationReviewSummary literal matching the real shape in @/lib/bigquery/queries
// (avgRating/totalReviews/distribution/featured/topReviews) — the assertion only
// needs to round-trip whatever the map holds.
const reviewSummary: LocationReviewSummary = {
  avgRating: 4.8,
  totalReviews: 120,
  distribution: [],
  featured: null,
  topReviews: [],
}

describe("fetchOwnerLocationKpis", () => {
  beforeEach(() => {
    vi.resetModules()
    getNetSalesByLocation.mockReset().mockResolvedValue(new Map())
    getMcrByLocation.mockReset().mockResolvedValue(new Map())
    getMcrTrendByLocation.mockReset().mockResolvedValue(new Map())
    getReviewSummaryByLocation.mockReset().mockResolvedValue(new Map())
  })

  it("returns all-null without touching BigQuery when the session owner does not own the row", async () => {
    const { fetchOwnerLocationKpis } = await import("@/lib/kpi/fetch")
    const out = await fetchOwnerLocationKpis({
      rowOwnerIdentifier: "owner-1",
      sessionOwnerIdentifiers: ["owner-2"],
      bqLocationName: "Sugar House",
    })
    expect(out).toEqual({ netSales: null, membership: null, reviews: null })
    expect(getNetSalesByLocation).not.toHaveBeenCalled()
  })

  it("returns all-null when the row has no resolved BigQuery name", async () => {
    const { fetchOwnerLocationKpis } = await import("@/lib/kpi/fetch")
    const out = await fetchOwnerLocationKpis({
      rowOwnerIdentifier: "owner-1",
      sessionOwnerIdentifiers: ["owner-1"],
      bqLocationName: null,
    })
    expect(out).toEqual({ netSales: null, membership: null, reviews: null })
    expect(getNetSalesByLocation).not.toHaveBeenCalled()
  })

  it("builds Net Sales + MCR metrics and reviews for the owner's connected location", async () => {
    getNetSalesByLocation.mockResolvedValue(
      new Map([["Sugar House", { totalCents: 42_500_000, trend: [{ month: "2026-06", value: 35_000 }] }]])
    )
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))
    getMcrTrendByLocation.mockResolvedValue(
      new Map([["Sugar House", [{ month: "2026-06", value: 34.5 }]]])
    )
    getReviewSummaryByLocation.mockResolvedValue(
      new Map([["Sugar House", reviewSummary]])
    )

    const { fetchOwnerLocationKpis } = await import("@/lib/kpi/fetch")
    const out = await fetchOwnerLocationKpis({
      rowOwnerIdentifier: "owner-1",
      sessionOwnerIdentifiers: ["owner-1"],
      bqLocationName: "Sugar House",
    })

    expect(out.netSales).not.toBeNull()
    expect(out.membership).not.toBeNull()
    expect(out.reviews).toEqual(reviewSummary)
  })

  it("falls back to a TTM point for MCR when no monthly trend exists", async () => {
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))
    // trend map stays empty
    const { fetchOwnerLocationKpis } = await import("@/lib/kpi/fetch")
    const out = await fetchOwnerLocationKpis({
      rowOwnerIdentifier: "owner-1",
      sessionOwnerIdentifiers: ["owner-1"],
      bqLocationName: "Sugar House",
    })
    expect(out.membership).not.toBeNull()
    expect(out.netSales).toBeNull() // no net-sales entry for this location
  })
})
