import { describe, it, expect } from "vitest"
import {
  annotateAndSortCompetitors,
  toOwnerPoints,
} from "@/lib/competitor-sort"
import type { CompetitorClosure } from "@/lib/competitor-query"

function makeCompetitor(overrides: Partial<CompetitorClosure>): CompetitorClosure {
  return {
    googlePlaceId: "p1",
    brandId: "ewc",
    brandName: "European Wax Center",
    address: "1 Main St",
    city: "Salt Lake City",
    state: "UT",
    latitude: 40.76,
    longitude: -111.89,
    businessStatus: "CLOSED_PERMANENTLY",
    closedAt: null,
    nearestHsName: null,
    nearestHsMiles: null,
    isOpportunity: false,
    mapsUrl: null,
    ...overrides,
  }
}

// Sugar House SLC ≈ (40.7250, -111.8600); downtown SLC ≈ (40.7608, -111.8910)
const SUGAR_HOUSE = { name: "Sugar House", latitude: 40.725, longitude: -111.86 }
const PROVO = { name: "Provo", latitude: 40.2338, longitude: -111.6585 }

describe("annotateAndSortCompetitors", () => {
  it("sorts by distance to the nearest owned salon and annotates it", () => {
    const near = makeCompetitor({ googlePlaceId: "near", latitude: 40.73, longitude: -111.86 })
    const far = makeCompetitor({ googlePlaceId: "far", latitude: 41.5, longitude: -112.0 })
    const result = annotateAndSortCompetitors([far, near], {
      ownerPoints: [SUGAR_HOUSE, PROVO],
    })
    expect(result.map((c) => c.googlePlaceId)).toEqual(["near", "far"])
    expect(result[0].ownerDistanceFrom).toBe("Sugar House")
    expect(result[0].ownerDistanceMiles).toBeGreaterThan(0)
    expect(result[0].ownerDistanceMiles).toBeLessThan(2)
  })

  it("prefers the searched center over owned locations for ordering", () => {
    // Owned salon is near "a"; the searched center is near "b" → center wins.
    const a = makeCompetitor({ googlePlaceId: "a", latitude: 40.726, longitude: -111.861 })
    const b = makeCompetitor({ googlePlaceId: "b", latitude: 40.24, longitude: -111.66 })
    const result = annotateAndSortCompetitors([a, b], {
      searchCenter: { lat: 40.2338, lng: -111.6585 }, // Provo
      ownerPoints: [SUGAR_HOUSE],
    })
    expect(result.map((c) => c.googlePlaceId)).toEqual(["b", "a"])
    // Owner annotation still present even when the center drives the sort.
    expect(result.find((c) => c.googlePlaceId === "a")!.ownerDistanceFrom).toBe("Sugar House")
  })

  it("falls back to opportunities-first, then newest closedAt, for non-owners", () => {
    const oldOpp = makeCompetitor({ googlePlaceId: "oldOpp", isOpportunity: true, closedAt: "2026-01-01T00:00:00.000Z" })
    const newPlain = makeCompetitor({ googlePlaceId: "newPlain", closedAt: "2026-07-01T00:00:00.000Z" })
    const oldPlain = makeCompetitor({ googlePlaceId: "oldPlain", closedAt: "2026-02-01T00:00:00.000Z" })
    const nullPlain = makeCompetitor({ googlePlaceId: "nullPlain", closedAt: null })
    const result = annotateAndSortCompetitors([nullPlain, oldPlain, newPlain, oldOpp], {})
    expect(result.map((c) => c.googlePlaceId)).toEqual(["oldOpp", "newPlain", "oldPlain", "nullPlain"])
    expect(result[0].ownerDistanceMiles).toBeNull()
  })
})

describe("toOwnerPoints", () => {
  it("drops locations without coordinates", () => {
    const points = toOwnerPoints([
      { blvdLocationName: "Sugar House", latitude: 40.725, longitude: -111.86 },
      { blvdLocationName: "No Coords", latitude: null, longitude: null },
    ])
    expect(points).toEqual([{ name: "Sugar House", latitude: 40.725, longitude: -111.86 }])
  })
})
