import { describe, it, expect } from "vitest"
import { competitorToSnapshot } from "@/lib/saved-competitors"
import type { CompetitorClosure } from "@/lib/competitor-query"

const closure: CompetitorClosure = {
  googlePlaceId: "place-123",
  brandId: "ewc",
  brandName: "European Wax Center",
  address: "123 Main St",
  city: "Provo",
  state: "UT",
  latitude: 40.2338,
  longitude: -111.6585,
  businessStatus: "CLOSED_PERMANENTLY",
  closedAt: "2026-05-01T00:00:00.000Z",
  nearestHsName: "Hello Sugar Provo",
  nearestHsMiles: 2.3,
  isOpportunity: true,
  mapsUrl: "https://maps.google.com/?cid=1",
}

describe("competitorToSnapshot", () => {
  it("maps a CompetitorClosure to the saved-competitor input payload", () => {
    expect(competitorToSnapshot(closure)).toEqual({
      placeId: "place-123",
      brandName: "European Wax Center",
      address: "123 Main St",
      city: "Provo",
      state: "UT",
      lat: 40.2338,
      lng: -111.6585,
      businessStatus: "CLOSED_PERMANENTLY",
      mapsUrl: "https://maps.google.com/?cid=1",
    })
  })

  it("preserves a null mapsUrl", () => {
    expect(competitorToSnapshot({ ...closure, mapsUrl: null }).mapsUrl).toBeNull()
  })
})
