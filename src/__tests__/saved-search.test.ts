import { describe, it, expect } from "vitest"
import { describeSavedSearch, savedSearchToBrowseParams } from "@/lib/saved-search"

const empty = {
  query: null, states: null, listingTypes: null, minPrice: null, maxPrice: null,
  minYearsOpen: null, sort: null, centerLat: null, centerLng: null, radiusMiles: null, centerLabel: null,
}

describe("describeSavedSearch", () => {
  it("returns 'All listings' when nothing is set", () => {
    expect(describeSavedSearch(empty)).toBe("All listings")
  })

  it("summarizes types, price, and radius", () => {
    const s = describeSavedSearch({
      ...empty,
      listingTypes: ["suite"],
      maxPrice: 100_000_000, // $1M
      centerLat: 40.2, centerLng: -111.6, radiusMiles: 25, centerLabel: "Provo, UT",
    })
    expect(s).toContain("Suite")
    expect(s).toContain("≤$1M")
    expect(s).toContain("within 25 mi of Provo, UT")
  })

  it("collapses many states to a count", () => {
    expect(describeSavedSearch({ ...empty, states: ["UT", "AZ", "ID"] })).toContain("3 states")
  })
})

describe("savedSearchToBrowseParams", () => {
  it("omits unset fields", () => {
    expect(savedSearchToBrowseParams(empty)).toBe("")
  })

  it("serializes arrays comma-separated and includes center", () => {
    const qs = savedSearchToBrowseParams({
      ...empty,
      listingTypes: ["suite", "flagship"],
      states: ["UT"],
      minPrice: 50_000_000,
      centerLat: 40.2, centerLng: -111.6, radiusMiles: 25, centerLabel: "Provo, UT",
      sort: "distance",
    })
    const params = new URLSearchParams(qs)
    expect(params.get("types")).toBe("suite,flagship")
    expect(params.get("states")).toBe("UT")
    expect(params.get("minPrice")).toBe("50000000")
    expect(params.get("radiusMiles")).toBe("25")
    expect(params.get("centerLabel")).toBe("Provo, UT")
    expect(params.get("sort")).toBe("distance")
  })
})
