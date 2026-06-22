import { describe, it, expect } from "vitest"
import { shouldShowRadiusHint } from "@/components/browse/RadiusSearchHint"

describe("shouldShowRadiusHint", () => {
  it("shows in map view with no center and not dismissed", () => {
    expect(shouldShowRadiusHint("map", false, false)).toBe(true)
  })

  it("hides once a location (center) is set", () => {
    expect(shouldShowRadiusHint("map", true, false)).toBe(false)
  })

  it("hides when dismissed", () => {
    expect(shouldShowRadiusHint("map", false, true)).toBe(false)
  })

  it("hides in list view regardless of center/dismissed", () => {
    expect(shouldShowRadiusHint("list", false, false)).toBe(false)
    expect(shouldShowRadiusHint("list", true, true)).toBe(false)
  })
})
