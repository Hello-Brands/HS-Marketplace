import { describe, it, expect } from "vitest"
import { hasAnyRealFilter, scopeSelected } from "@/lib/save-search-validation"

describe("hasAnyRealFilter", () => {
  it("rejects an empty filter set (sort alone doesn't count)", () => {
    expect(hasAnyRealFilter({})).toBe(false)
  })
  it("accepts a full geo circle but not a partial one", () => {
    expect(hasAnyRealFilter({ centerLat: 40.7, centerLng: -111.9, radiusMiles: 5 })).toBe(true)
    expect(hasAnyRealFilter({ centerLat: 40.7, centerLng: -111.9 })).toBe(false)
  })
  it("accepts each scalar filter", () => {
    expect(hasAnyRealFilter({ query: "salon" })).toBe(true)
    expect(hasAnyRealFilter({ query: "   " })).toBe(false)
    expect(hasAnyRealFilter({ types: ["suite"] })).toBe(true)
    expect(hasAnyRealFilter({ states: ["UT"] })).toBe(true)
    expect(hasAnyRealFilter({ minPrice: 0 })).toBe(true)
    expect(hasAnyRealFilter({ maxPrice: 100_000_00 })).toBe(true)
    expect(hasAnyRealFilter({ minYearsOpen: 2 })).toBe(true)
    expect(hasAnyRealFilter({ minYearsOpen: 0 })).toBe(false)
    expect(hasAnyRealFilter({ inventoryIncluded: true })).toBe(true)
  })
})

describe("scopeSelected", () => {
  it("requires at least one channel", () => {
    expect(scopeSelected({ includeListings: false, includeCompetitors: false })).toBe(false)
    expect(scopeSelected({ includeListings: true, includeCompetitors: false })).toBe(true)
    expect(scopeSelected({ includeListings: false, includeCompetitors: true })).toBe(true)
  })
})
