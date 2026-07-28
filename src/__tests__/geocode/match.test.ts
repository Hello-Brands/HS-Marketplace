import { describe, it, expect } from "vitest"
import {
  isAcceptableMatch,
  isStreetLevel,
  toCandidate,
  RELEVANCE_THRESHOLD,
  RELEVANCE_FLOOR,
  type GeocodeCandidate,
} from "@/lib/geocode/match"

/**
 * Every case here is a real MapTiler response for a real directory address,
 * recorded while diagnosing the 48 owner_locations rows that had no
 * coordinates. The relevance values are measured, not invented.
 */
function candidate(over: Partial<GeocodeCandidate> = {}): GeocodeCandidate {
  return {
    lat: 40,
    lng: -111,
    relevance: 0.9,
    placeName: "somewhere",
    placeTypes: ["address"],
    postalCode: "84096",
    ...over,
  }
}

describe("toCandidate", () => {
  it("pulls center, relevance, place types and the postal_code context", () => {
    expect(
      toCandidate({
        center: [-111.9, 40.5],
        relevance: 0.825,
        place_name: "Tree Sparrow Drive, Riverton, Utah 84096, United States",
        place_type: ["address"],
        context: [
          { id: "postal_code.123", text: "84096" },
          { id: "region.9", text: "Utah" },
        ],
      }),
    ).toEqual({
      lat: 40.5,
      lng: -111.9,
      relevance: 0.825,
      placeName: "Tree Sparrow Drive, Riverton, Utah 84096, United States",
      placeTypes: ["address"],
      postalCode: "84096",
    })
  })

  it("returns null without a center, and tolerates missing fields", () => {
    expect(toCandidate(undefined)).toBeNull()
    expect(toCandidate({ relevance: 1 })).toBeNull()
    expect(toCandidate({ center: [1, 2] })).toEqual({
      lat: 2,
      lng: 1,
      relevance: 0,
      placeName: "",
      placeTypes: [],
      postalCode: null,
    })
  })
})

describe("isStreetLevel", () => {
  it("accepts address/street/poi hits", () => {
    for (const t of ["address", "street", "poi"]) {
      expect(isStreetLevel(candidate({ placeTypes: [t] }))).toBe(true)
    }
  })

  it("rejects ZIP and town centroids", () => {
    expect(isStreetLevel(candidate({ placeTypes: ["postal_code"] }))).toBe(false)
    expect(isStreetLevel(candidate({ placeTypes: ["place"] }))).toBe(false)
    expect(isStreetLevel(candidate({ placeTypes: [] }))).toBe(false)
  })
})

describe("isAcceptableMatch", () => {
  it("accepts a confident street-level match", () => {
    expect(isAcceptableMatch(candidate({ relevance: RELEVANCE_THRESHOLD }), "84096")).toBe(true)
  })

  it("accepts a confident match even with no ZIP to check against", () => {
    expect(isAcceptableMatch(candidate({ relevance: 0.95 }), null)).toBe(true)
  })

  // A ZIP centroid comes back at relevance 1.0. Trusting the score alone would
  // write the middle of the ZIP as though it were the salon's address.
  it("rejects a ZIP centroid even at relevance 1.0", () => {
    expect(
      isAcceptableMatch(
        candidate({ relevance: 1, placeTypes: ["postal_code"], placeName: "79912, Texas" }),
        "79912",
      ),
    ).toBe(false)
  })

  it("rejects a town centroid", () => {
    expect(
      isAcceptableMatch(candidate({ relevance: 1, placeTypes: ["place"], postalCode: null }), "55416"),
    ).toBe(false)
  })

  describe("the validated path for under-scored matches", () => {
    it("accepts CO Boulder (0.778) because the ZIP agrees", () => {
      expect(
        isAcceptableMatch(
          candidate({
            relevance: 0.778,
            placeName: "4800 Baseline Road, Boulder, Colorado 80303",
            postalCode: "80303",
          }),
          "80303",
        ),
      ).toBe(true)
    })

    it("accepts PA Pittsburgh (0.750) despite a neighbouring-city label", () => {
      // MapTiler labels it Bethel Park; 15241 is the address's own ZIP.
      expect(
        isAcceptableMatch(
          candidate({
            relevance: 0.75,
            placeName: "301 South Hills Village, Bethel Park, Pennsylvania 15241",
            postalCode: "15241",
          }),
          "15241",
        ),
      ).toBe(true)
    })

    // The reason this is ZIP validation and not just a lower threshold.
    it("rejects TX Austin (0.711), which resolves ~150 miles away in Salado", () => {
      expect(
        isAcceptableMatch(
          candidate({
            relevance: 0.711,
            placeName: "North Robertson Road, Salado, Texas 76571",
            postalCode: "76571",
          }),
          "78747",
        ),
      ).toBe(false)
    })

    it("rejects NC Charlotte (0.589): right ZIP, wrong street", () => {
      // "650 E Brooklyn Vlg Ave" -> "650 E 8th Street". Below the floor.
      expect(
        isAcceptableMatch(
          candidate({
            relevance: 0.589,
            placeName: "650 E 8th Street, Charlotte, North Carolina 28202",
            postalCode: "28202",
          }),
          "28202",
        ),
      ).toBe(false)
    })

    it("rejects a sub-threshold match when the address has no parseable ZIP", () => {
      expect(isAcceptableMatch(candidate({ relevance: 0.75 }), null)).toBe(false)
    })

    it("treats the floor as inclusive and anything under it as untrusted", () => {
      const c = (relevance: number) => candidate({ relevance, postalCode: "84096" })
      expect(isAcceptableMatch(c(RELEVANCE_FLOOR), "84096")).toBe(true)
      expect(isAcceptableMatch(c(RELEVANCE_FLOOR - 0.001), "84096")).toBe(false)
    })

    it("rejects a sub-threshold match whose ZIP is merely absent", () => {
      expect(isAcceptableMatch(candidate({ relevance: 0.75, postalCode: null }), "84096")).toBe(
        false,
      )
    })
  })
})
