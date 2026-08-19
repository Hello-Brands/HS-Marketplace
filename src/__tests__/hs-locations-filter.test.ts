import { describe, it, expect } from "vitest"
import {
  isLocationOpen,
  locationType,
  openedSinceYear,
  locationDedupeKey,
  isNotListed,
  hsLocationInScope,
  type HsLocationOpenDates,
} from "@/lib/hs-locations-filter"

const NOW = new Date("2026-07-06T00:00:00Z")
const d = (s: string) => new Date(s)
const dates = (o: Partial<HsLocationOpenDates>): HsLocationOpenDates => ({
  actualSuiteGoDate: null,
  suiteClosedDate: null,
  actualFlagshipGoDate: null,
  flagshipClosedDate: null,
  ...o,
})

describe("isLocationOpen", () => {
  it("is open when the suite has gone and not closed", () => {
    expect(isLocationOpen(dates({ actualSuiteGoDate: d("2019-01-01") }), NOW)).toBe(true)
  })
  it("is open when the flagship has gone and not closed", () => {
    expect(isLocationOpen(dates({ actualFlagshipGoDate: d("2020-05-01") }), NOW)).toBe(true)
  })
  it("is closed when the only open track has a past closed date", () => {
    expect(
      isLocationOpen(dates({ actualSuiteGoDate: d("2019-01-01"), suiteClosedDate: d("2024-01-01") }), NOW)
    ).toBe(false)
  })
  it("treats a future closed date as still open", () => {
    expect(
      isLocationOpen(dates({ actualSuiteGoDate: d("2019-01-01"), suiteClosedDate: d("2027-01-01") }), NOW)
    ).toBe(true)
  })
  it("is not open when the go date is in the future", () => {
    expect(isLocationOpen(dates({ actualSuiteGoDate: d("2027-01-01") }), NOW)).toBe(false)
  })
  it("is not open with no go dates at all", () => {
    expect(isLocationOpen(dates({}), NOW)).toBe(false)
  })
  it("stays open on the flagship track when the suite track has closed", () => {
    expect(
      isLocationOpen(
        dates({
          actualSuiteGoDate: d("2019-01-01"),
          suiteClosedDate: d("2024-01-01"),
          actualFlagshipGoDate: d("2020-01-01"),
        }),
        NOW
      )
    ).toBe(true)
  })
  // unstable_cache serializes its result, so timestamp columns reach these
  // helpers as ISO strings rather than Date objects. The helpers must handle
  // that form or the /browse HS-location dots silently vanish (the query's
  // catch turns the .getTime() TypeError into an empty result set).
  it("accepts ISO-string dates (post-cache serialization)", () => {
    expect(
      isLocationOpen(dates({ actualSuiteGoDate: "2019-01-01T00:00:00.000Z" }), NOW)
    ).toBe(true)
    expect(
      isLocationOpen(
        dates({
          actualSuiteGoDate: "2019-01-01T00:00:00.000Z",
          suiteClosedDate: "2024-01-01T00:00:00.000Z",
        }),
        NOW
      )
    ).toBe(false)
  })
})

describe("locationType", () => {
  it("is suite when only the suite track is open", () => {
    expect(locationType(dates({ actualSuiteGoDate: d("2019-01-01") }), NOW)).toBe("suite")
  })
  it("is flagship when only the flagship track is open", () => {
    expect(locationType(dates({ actualFlagshipGoDate: d("2020-05-01") }), NOW)).toBe("flagship")
  })
  it("is both when both tracks are open", () => {
    expect(
      locationType(
        dates({ actualSuiteGoDate: d("2019-01-01"), actualFlagshipGoDate: d("2021-06-01") }),
        NOW
      )
    ).toBe("both")
  })
  it("ignores a track that has since closed", () => {
    expect(
      locationType(
        dates({
          actualSuiteGoDate: d("2019-01-01"),
          suiteClosedDate: d("2024-01-01"),
          actualFlagshipGoDate: d("2020-01-01"),
        }),
        NOW
      )
    ).toBe("flagship")
  })
  it("ignores a track whose go date is in the future", () => {
    expect(
      locationType(
        dates({ actualSuiteGoDate: d("2019-01-01"), actualFlagshipGoDate: d("2027-01-01") }),
        NOW
      )
    ).toBe("suite")
  })
  it("is null when no track is open", () => {
    expect(locationType(dates({}), NOW)).toBeNull()
  })
  it("accepts ISO-string dates (post-cache serialization)", () => {
    expect(
      locationType(dates({ actualSuiteGoDate: "2019-01-01T00:00:00.000Z" }), NOW)
    ).toBe("suite")
  })
})

describe("openedSinceYear", () => {
  it("returns the earliest go-date year", () => {
    expect(
      openedSinceYear(dates({ actualSuiteGoDate: d("2021-03-01"), actualFlagshipGoDate: d("2019-08-01") }))
    ).toBe(2019)
  })
  it("returns null when neither go date is set", () => {
    expect(openedSinceYear(dates({}))).toBeNull()
  })
  it("accepts ISO-string dates (post-cache serialization)", () => {
    expect(
      openedSinceYear(
        dates({
          actualSuiteGoDate: "2021-03-01T00:00:00.000Z",
          actualFlagshipGoDate: "2019-08-01T00:00:00.000Z",
        })
      )
    ).toBe(2019)
  })
})

describe("locationDedupeKey", () => {
  it("prefers the blvd location number", () => {
    expect(locationDedupeKey({ blvdLocationNumber: "  H123 ", blvdLocationName: "Austin" })).toBe("num:H123")
  })
  it("falls back to the normalized name when no number", () => {
    expect(locationDedupeKey({ blvdLocationNumber: null, blvdLocationName: "  Austin Domain " })).toBe(
      "name:austin domain"
    )
  })
})

describe("isNotListed", () => {
  const listed = new Set(["Austin Domain", "Dallas Uptown"])
  it("is not listed when the resolved name is absent from the active set", () => {
    expect(isNotListed("Houston Heights", listed)).toBe(true)
  })
  it("is listed (excluded) when the resolved name is in the active set", () => {
    expect(isNotListed("Austin Domain", listed)).toBe(false)
  })
  it("treats an unresolved (null) name as not listed", () => {
    expect(isNotListed(null, listed)).toBe(true)
  })
})

describe("hsLocationInScope", () => {
  const loc = { latitude: 30.4, longitude: -97.72, state: "TX" }
  it("passes with no scope constraints", () => {
    expect(hsLocationInScope(loc, {})).toBe(true)
  })
  it("filters by state set", () => {
    expect(hsLocationInScope(loc, { states: ["CA"] })).toBe(false)
    expect(hsLocationInScope(loc, { states: ["TX"] })).toBe(true)
  })
  it("excludes a null-state location when a state filter is active", () => {
    expect(hsLocationInScope({ ...loc, state: null }, { states: ["TX"] })).toBe(false)
  })
  it("filters by radius", () => {
    expect(
      hsLocationInScope(loc, { centerLat: 30.4, centerLng: -97.72, radiusMiles: 5 })
    ).toBe(true)
    expect(
      hsLocationInScope(loc, { centerLat: 40.0, centerLng: -97.72, radiusMiles: 5 })
    ).toBe(false)
  })
})
