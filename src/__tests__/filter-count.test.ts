import { describe, it, expect } from "vitest"
import { countListingFilters, type CountableFilters } from "@/lib/filter-count"

const NONE: CountableFilters = {
  query: "",
  types: [],
  states: [],
  minPrice: null,
  maxPrice: null,
  minYearsOpen: null,
  inventoryIncluded: false,
  centerLat: null,
}

describe("countListingFilters", () => {
  it("returns 0 with no active filters", () => {
    expect(countListingFilters(NONE)).toBe(0)
  })

  it("counts each facet once", () => {
    expect(
      countListingFilters({
        ...NONE,
        query: "salon",
        types: ["suite", "flagship"],
        states: ["ID"],
        minPrice: 100_000_00,
        maxPrice: 500_000_00,
        minYearsOpen: 2,
        inventoryIncluded: true,
        centerLat: 43.6,
      })
    ).toBe(7)
  })

  it("counts a price range as one facet and ignores minYearsOpen of 0", () => {
    expect(countListingFilters({ ...NONE, minPrice: 100_00 })).toBe(1)
    expect(countListingFilters({ ...NONE, minPrice: 100_00, maxPrice: 200_00 })).toBe(1)
    expect(countListingFilters({ ...NONE, minYearsOpen: 0 })).toBe(0)
  })
})
