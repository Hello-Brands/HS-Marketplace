import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { rowsToNetSalesMap, rowsToMcrMap } from "@/lib/bigquery/queries"

describe("rowsToNetSalesMap", () => {
  it("converts dollars to integer cents keyed by LOCATION_NAME", () => {
    const map = rowsToNetSalesMap([
      { LOCATION_NAME: "Sugar House", cash_plus_credit: 168000.55 },
      { LOCATION_NAME: "Decatur", cash_plus_credit: 42000 },
    ])
    expect(map.get("Sugar House")).toBe(16800055)
    expect(map.get("Decatur")).toBe(4200000)
  })

  it("skips rows with null/blank location name", () => {
    const map = rowsToNetSalesMap([{ LOCATION_NAME: null, cash_plus_credit: 100 }])
    expect(map.size).toBe(0)
  })

  it("coerces string / Big-like numeric values (NUMERIC columns)", () => {
    const map = rowsToNetSalesMap([
      { LOCATION_NAME: "Str", cash_plus_credit: "168000.55" },
      { LOCATION_NAME: "Big", cash_plus_credit: { toString: () => "4200.00" } },
    ])
    expect(map.get("Str")).toBe(16800055)
    expect(map.get("Big")).toBe(420000)
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
