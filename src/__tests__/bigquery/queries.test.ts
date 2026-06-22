import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { rowsToNetSalesByLocation, rowsToMcrMap } from "@/lib/bigquery/queries"

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
      { month: "2025-07", value: 200 },
      { month: "2025-08", value: 100.5 },
      { month: "2025-09", value: 50 },
    ])
  })

  it("skips rows with null/blank location name", () => {
    const map = rowsToNetSalesByLocation([
      { LOCATION_NAME: null, sales_month: "2025-07", cash_plus_credit: 100 },
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
