import { describe, it, expect } from "vitest"
import { aggregateBundleLocationKpis, type BundleLocationKpi } from "@/lib/kpi/bundle"
import type { KpiMetric } from "@/lib/kpi/schema"

function metric(lastMonth: number, trend: [string, number][]): KpiMetric {
  return {
    lastMonth,
    momChange: 0,
    trend: trend.map(([month, value]) => ({ month, value })),
    updatedAt: "2026-06-01T00:00:00Z",
    source: "bigquery",
  }
}

describe("aggregateBundleLocationKpis", () => {
  it("sums Net Sales and averages MCR across locations", () => {
    const locs: BundleLocationKpi[] = [
      { id: "a", name: "A", netSales: metric(1000, [["Jan", 400], ["Feb", 600]]), membership: metric(30, [["Jan", 28], ["Feb", 32]]) },
      { id: "b", name: "B", netSales: metric(500, [["Jan", 200], ["Feb", 300]]), membership: metric(40, [["Jan", 38], ["Feb", 42]]) },
    ]
    const agg = aggregateBundleLocationKpis(locs)
    expect(agg.netSales?.lastMonth).toBe(1500)            // 1000 + 500
    expect(agg.membership?.lastMonth).toBe(35)            // (30 + 40) / 2
    expect(agg.netSales?.trend).toEqual([
      { month: "Jan", value: 600 },                       // 400 + 200
      { month: "Feb", value: 900 },                       // 600 + 300
    ])
    expect(agg.membership?.trend).toEqual([
      { month: "Jan", value: 33 },                        // (28 + 38) / 2
      { month: "Feb", value: 37 },                        // (32 + 42) / 2
    ])
  })

  it("preserves chronological trend order (no alphabetical re-sort)", () => {
    const locs: BundleLocationKpi[] = [
      { id: "a", name: "A", netSales: metric(3, [["Jan", 1], ["Feb", 1], ["Mar", 1]]), membership: null },
    ]
    const agg = aggregateBundleLocationKpis(locs)
    expect(agg.netSales?.trend.map(p => p.month)).toEqual(["Jan", "Feb", "Mar"])
  })

  it("ignores null metrics; returns null when none present", () => {
    const locs: BundleLocationKpi[] = [
      { id: "a", name: "A", netSales: metric(100, [["Jan", 100]]), membership: null },
      { id: "b", name: "B", netSales: null, membership: null },
    ]
    const agg = aggregateBundleLocationKpis(locs)
    expect(agg.netSales?.lastMonth).toBe(100)
    expect(agg.membership).toBeNull()
  })

  it("returns both null for an empty list", () => {
    const agg = aggregateBundleLocationKpis([])
    expect(agg.netSales).toBeNull()
    expect(agg.membership).toBeNull()
  })

  it("cross-location trend merge keeps chronological order and sums overlapping months", () => {
    // Location A: Nov, Dec — Location B: Dec, Jan
    // Naive alphabetical sort would reorder to Dec, Jan, Nov — must NOT happen.
    const locs: BundleLocationKpi[] = [
      { id: "a", name: "A", netSales: metric(200, [["Nov", 100], ["Dec", 200]]), membership: null },
      { id: "b", name: "B", netSales: metric(25,  [["Dec", 50],  ["Jan", 25]]),  membership: null },
    ]
    const agg = aggregateBundleLocationKpis(locs)
    // Nov from A only; Dec = 200+50 = 250; Jan from B only; order must be Nov→Dec→Jan
    expect(agg.netSales?.trend).toEqual([
      { month: "Nov", value: 100 },
      { month: "Dec", value: 250 },
      { month: "Jan", value: 25 },
    ])
    // Last two trend points: Dec=250 → Jan=25; momChange = (25-250)/250 = -0.9
    expect(agg.netSales?.momChange).toBeCloseTo((25 - 250) / 250)
    expect(agg.membership).toBeNull()
  })
})
