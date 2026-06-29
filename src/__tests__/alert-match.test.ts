import { describe, it, expect } from "vitest"
import { listingMatchesAlert, type AlertMatchCriteria } from "@/lib/alert-match"

const NOW = new Date("2026-06-29T00:00:00Z")

const baseAlert: AlertMatchCriteria = {
  notifyEnabled: true,
  includeListings: true,
  states: [],
  listingTypes: [],
  minPrice: null,
  maxPrice: null,
  minYearsOpen: null,
  centerLat: null,
  centerLng: null,
  radiusMiles: null,
}
const listing = { type: "suite", state: "AZ", askingPrice: 5_000_000 }

describe("listingMatchesAlert", () => {
  it("matches an unconstrained, enabled alert", () => {
    expect(listingMatchesAlert(baseAlert, listing, [], NOW)).toBe(true)
  })
  it("does not match when notifyEnabled is false", () => {
    expect(listingMatchesAlert({ ...baseAlert, notifyEnabled: false }, listing, [], NOW)).toBe(false)
  })
  it("does not match when includeListings is false (the HS toggle gate)", () => {
    expect(listingMatchesAlert({ ...baseAlert, includeListings: false }, listing, [], NOW)).toBe(false)
  })
  it("filters by state", () => {
    expect(listingMatchesAlert({ ...baseAlert, states: ["TX"] }, listing, [], NOW)).toBe(false)
    expect(listingMatchesAlert({ ...baseAlert, states: ["AZ"] }, listing, [], NOW)).toBe(true)
  })
  it("filters by listing type", () => {
    expect(listingMatchesAlert({ ...baseAlert, listingTypes: ["flagship"] }, listing, [], NOW)).toBe(false)
  })
  it("filters by price range (cents)", () => {
    expect(listingMatchesAlert({ ...baseAlert, minPrice: 6_000_000 }, listing, [], NOW)).toBe(false)
    expect(listingMatchesAlert({ ...baseAlert, maxPrice: 4_000_000 }, listing, [], NOW)).toBe(false)
    expect(listingMatchesAlert({ ...baseAlert, minPrice: 1_000_000, maxPrice: 9_000_000 }, listing, [], NOW)).toBe(true)
  })
  it("requires a location open long enough for minYearsOpen", () => {
    const loc = { latitude: null, longitude: null, territoryLat: null, territoryLng: null, openingDate: new Date("2020-01-01") }
    expect(listingMatchesAlert({ ...baseAlert, minYearsOpen: 3 }, listing, [loc], NOW)).toBe(true)
    expect(listingMatchesAlert({ ...baseAlert, minYearsOpen: 3 }, listing, [], NOW)).toBe(false)
  })
  it("requires a location within radius", () => {
    const near = { latitude: 33.5, longitude: -112.07, territoryLat: null, territoryLng: null, openingDate: null }
    const scope = { centerLat: 33.45, centerLng: -112.07, radiusMiles: 25 }
    expect(listingMatchesAlert({ ...baseAlert, ...scope }, listing, [near], NOW)).toBe(true)
    expect(listingMatchesAlert({ ...baseAlert, ...scope }, listing, [], NOW)).toBe(false)
  })
})
