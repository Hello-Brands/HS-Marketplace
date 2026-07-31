import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { resolveOwnerRowCoords } from "@/lib/owner-directory/monday-coords"

const NOW = new Date("2026-07-31T12:00:00Z")
const coords = new Map([["284", { lat: 40.691574, lng: -73.988771 }]])

describe("resolveOwnerRowCoords", () => {
  it("applies Monday coords for a covered number, overwriting a differing prior", () => {
    const prior = {
      latitude: 1, longitude: 2,
      geocodedAt: new Date("2025-01-01"), coordSource: "maptiler",
    }
    expect(resolveOwnerRowCoords("284", prior, coords, NOW)).toEqual({
      latitude: 40.691574, longitude: -73.988771, geocodedAt: NOW, coordSource: "monday",
    })
  })

  it("trims the incoming number before lookup", () => {
    expect(resolveOwnerRowCoords(" 284 ", null, coords, NOW).coordSource).toBe("monday")
  })

  it("preserves prior coords (and their source) for an uncovered number", () => {
    const prior = {
      latitude: 35.6, longitude: -82.5,
      geocodedAt: new Date("2025-01-01"), coordSource: "maptiler",
    }
    expect(resolveOwnerRowCoords("999", prior, coords, NOW)).toEqual(prior)
  })

  it("returns all-null for an uncovered row with no prior", () => {
    expect(resolveOwnerRowCoords(null, null, coords, NOW)).toEqual({
      latitude: null, longitude: null, geocodedAt: null, coordSource: null,
    })
  })

  it("falls back to prior when the coords map is null (BigQuery failure)", () => {
    const prior = {
      latitude: 35.6, longitude: -82.5, geocodedAt: null, coordSource: null,
    }
    expect(resolveOwnerRowCoords("284", prior, null, NOW)).toEqual(prior)
  })
})
