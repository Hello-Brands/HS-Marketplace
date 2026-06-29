import { describe, it, expect } from "vitest"
import {
  competitorInScope,
  filterCompetitorsByScope,
  scopeIsBounded,
  selectUnloggedCompetitors,
} from "@/lib/competitor-filter"

// Phoenix center; ~3 mi point is in a 25 mi radius, Dallas is far out.
const phx = { latitude: 33.45, longitude: -112.07, state: "AZ", googlePlaceId: "phx" }
const phxNear = { latitude: 33.5, longitude: -112.07, state: "AZ", googlePlaceId: "near" } // ~3.5 mi
const dallas = { latitude: 32.78, longitude: -96.8, state: "TX", googlePlaceId: "dal" }

describe("competitorInScope", () => {
  it("passes everything when scope has no geo and no states", () => {
    expect(competitorInScope(dallas, {})).toBe(true)
  })
  it("filters by state when states are set", () => {
    expect(competitorInScope(phx, { states: ["AZ"] })).toBe(true)
    expect(competitorInScope(dallas, { states: ["AZ"] })).toBe(false)
  })
  it("filters by radius when center+radius are set", () => {
    const scope = { centerLat: 33.45, centerLng: -112.07, radiusMiles: 25 }
    expect(competitorInScope(phxNear, scope)).toBe(true)
    expect(competitorInScope(dallas, scope)).toBe(false)
  })
  it("requires BOTH state and radius when both are set", () => {
    const scope = { centerLat: 33.45, centerLng: -112.07, radiusMiles: 25, states: ["TX"] }
    expect(competitorInScope(phxNear, scope)).toBe(false) // in radius, wrong state
  })
})

describe("filterCompetitorsByScope", () => {
  it("returns only the in-scope competitors", () => {
    const out = filterCompetitorsByScope([phxNear, dallas], {
      centerLat: 33.45, centerLng: -112.07, radiusMiles: 25,
    })
    expect(out.map((c) => c.googlePlaceId)).toEqual(["near"])
  })
})

describe("scopeIsBounded", () => {
  it("is false with neither geo nor states", () => {
    expect(scopeIsBounded({})).toBe(false)
    expect(scopeIsBounded({ states: [] })).toBe(false)
  })
  it("is true with states or full geo", () => {
    expect(scopeIsBounded({ states: ["AZ"] })).toBe(true)
    expect(scopeIsBounded({ centerLat: 1, centerLng: 2, radiusMiles: 10 })).toBe(true)
  })
  it("is false with a partial geo (missing radius)", () => {
    expect(scopeIsBounded({ centerLat: 1, centerLng: 2 })).toBe(false)
  })
})

describe("selectUnloggedCompetitors", () => {
  it("returns only competitors not in the logged set", () => {
    const out = selectUnloggedCompetitors([phx, dallas], new Set(["phx"]))
    expect(out.map((c) => c.googlePlaceId)).toEqual(["dal"])
  })
})
