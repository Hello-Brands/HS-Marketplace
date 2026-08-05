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
  it("annotates the nearest owned salon without letting it drive the order", () => {
    // "far" is the newer detection, so it outranks the nearby-but-older "near".
    const near = makeCompetitor({
      googlePlaceId: "near",
      latitude: 40.73,
      longitude: -111.86,
      closedAt: "2026-01-01T00:00:00.000Z",
    })
    const far = makeCompetitor({
      googlePlaceId: "far",
      latitude: 41.5,
      longitude: -112.0,
      closedAt: "2026-07-01T00:00:00.000Z",
    })
    const result = annotateAndSortCompetitors([near, far], {
      ownerPoints: [SUGAR_HOUSE, PROVO],
    })
    expect(result.map((c) => c.googlePlaceId)).toEqual(["far", "near"])
    const annotatedNear = result.find((c) => c.googlePlaceId === "near")!
    expect(annotatedNear.ownerDistanceFrom).toBe("Sugar House")
    expect(annotatedNear.ownerDistanceMiles).toBeGreaterThan(0)
    expect(annotatedNear.ownerDistanceMiles).toBeLessThan(2)
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

  it("sorts by newest closedAt, giving opportunities no ordering boost", () => {
    const oldOpp = makeCompetitor({ googlePlaceId: "oldOpp", isOpportunity: true, closedAt: "2026-01-01T00:00:00.000Z" })
    const newPlain = makeCompetitor({ googlePlaceId: "newPlain", closedAt: "2026-07-01T00:00:00.000Z" })
    const oldPlain = makeCompetitor({ googlePlaceId: "oldPlain", closedAt: "2026-02-01T00:00:00.000Z" })
    const result = annotateAndSortCompetitors([oldOpp, oldPlain, newPlain], {})
    expect(result.map((c) => c.googlePlaceId)).toEqual(["newPlain", "oldPlain", "oldOpp"])
    expect(result[0].ownerDistanceMiles).toBeNull()
  })

  it("sinks closures with a missing or unparseable closedAt to the bottom", () => {
    const dated = makeCompetitor({ googlePlaceId: "dated", closedAt: "2026-02-01T00:00:00.000Z" })
    const nullDate = makeCompetitor({ googlePlaceId: "nullDate", closedAt: null })
    const junkDate = makeCompetitor({ googlePlaceId: "junkDate", closedAt: "not-a-date" })
    const result = annotateAndSortCompetitors([nullDate, junkDate, dated], {})
    expect(result[0].googlePlaceId).toBe("dated")
    expect(result.slice(1).map((c) => c.googlePlaceId).sort()).toEqual(["junkDate", "nullDate"])
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
