import { describe, it, expect } from "vitest"
import { haversineMiles, isWithinRadius, boundingBox } from "@/lib/geo"

// Reference points
const NYC = { lat: 40.7128, lng: -74.006 }
const LA = { lat: 34.0522, lng: -118.2437 }
const SF = { lat: 37.7749, lng: -122.4194 }
const OAKLAND = { lat: 37.8044, lng: -122.2712 }
const ATL_BUCKHEAD = { lat: 33.8389, lng: -84.3792 }
const ATL_MIDTOWN = { lat: 33.789, lng: -84.3833 }

describe("haversineMiles", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMiles(NYC.lat, NYC.lng, NYC.lat, NYC.lng)).toBe(0)
  })

  it("computes a known long distance (NYC -> LA ~2451 mi)", () => {
    const d = haversineMiles(NYC.lat, NYC.lng, LA.lat, LA.lng)
    expect(d).toBeGreaterThan(2400)
    expect(d).toBeLessThan(2500)
  })

  it("computes a known short distance (SF -> Oakland ~8 mi)", () => {
    const d = haversineMiles(SF.lat, SF.lng, OAKLAND.lat, OAKLAND.lng)
    expect(d).toBeGreaterThan(7)
    expect(d).toBeLessThan(9)
  })

  it("is symmetric", () => {
    const ab = haversineMiles(SF.lat, SF.lng, OAKLAND.lat, OAKLAND.lng)
    const ba = haversineMiles(OAKLAND.lat, OAKLAND.lng, SF.lat, SF.lng)
    expect(ab).toBeCloseTo(ba, 6)
  })
})

describe("isWithinRadius", () => {
  it("includes a point inside the radius", () => {
    // Buckhead -> Midtown is ~3.4 mi
    expect(isWithinRadius(ATL_BUCKHEAD.lat, ATL_BUCKHEAD.lng, ATL_MIDTOWN.lat, ATL_MIDTOWN.lng, 5)).toBe(true)
  })

  it("excludes a point outside the radius", () => {
    expect(isWithinRadius(ATL_BUCKHEAD.lat, ATL_BUCKHEAD.lng, ATL_MIDTOWN.lat, ATL_MIDTOWN.lng, 1)).toBe(false)
  })

  it("treats the same point as within any positive radius", () => {
    expect(isWithinRadius(NYC.lat, NYC.lng, NYC.lat, NYC.lng, 1)).toBe(true)
  })

  it("excludes a cross-country point for a small radius", () => {
    expect(isWithinRadius(NYC.lat, NYC.lng, LA.lat, LA.lng, 2000)).toBe(false)
    expect(isWithinRadius(NYC.lat, NYC.lng, LA.lat, LA.lng, 3000)).toBe(true)
  })
})

describe("boundingBox", () => {
  it("produces ~1 degree of latitude per ~69 miles", () => {
    const box = boundingBox(40, -74, 69)
    expect(box.latMin).toBeCloseTo(39, 5)
    expect(box.latMax).toBeCloseTo(41, 5)
  })

  it("widens longitude with latitude (lng span > lat span away from equator)", () => {
    const box = boundingBox(40, -74, 69)
    const latSpan = box.latMax - box.latMin
    const lngSpan = box.lngMax - box.lngMin
    expect(lngSpan).toBeGreaterThan(latSpan)
  })

  it("fully contains every point within the radius (prefilter is not too tight)", () => {
    const center = ATL_BUCKHEAD
    const radius = 10
    const box = boundingBox(center.lat, center.lng, radius)
    // A point ~9 mi away (within radius) must fall inside the box.
    const inside = ATL_MIDTOWN // ~3.4 mi, comfortably within 10
    expect(haversineMiles(center.lat, center.lng, inside.lat, inside.lng)).toBeLessThan(radius)
    expect(inside.lat).toBeGreaterThanOrEqual(box.latMin)
    expect(inside.lat).toBeLessThanOrEqual(box.latMax)
    expect(inside.lng).toBeGreaterThanOrEqual(box.lngMin)
    expect(inside.lng).toBeLessThanOrEqual(box.lngMax)
  })
})
