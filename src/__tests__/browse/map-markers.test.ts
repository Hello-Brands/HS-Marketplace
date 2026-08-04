import { describe, it, expect } from "vitest"
import {
  MARKER_ICON,
  MARKER_Z_BASE,
  markerVariant,
  hsMarkerLayer,
  markerZIndex,
} from "@/lib/browse/map-markers"

describe("markerVariant", () => {
  it("gives a for-sale listing the wordmark badge variant", () => {
    expect(markerVariant("listing", false)).toBe("forSale")
  })
  it("gives an unlisted Hello Sugar salon the white swirl variant", () => {
    expect(markerVariant("hsLocation", false)).toBe("unlisted")
  })
  it("lets ownership outrank for-sale status", () => {
    expect(markerVariant("listing", true)).toBe("owned")
  })
  it("marks an owned unlisted salon owned too", () => {
    expect(markerVariant("hsLocation", true)).toBe("owned")
  })
})

describe("MARKER_ICON", () => {
  // The swap: the loud wordmark badge now flags what a buyer is here for.
  it("points for-sale at the wordmark badge asset", () => {
    expect(MARKER_ICON.forSale).toBe("/markers/hs-marker-owner.png")
  })
  it("points owned at the red swirl asset", () => {
    expect(MARKER_ICON.owned).toBe("/markers/hs-marker-color.png")
  })
  it("leaves unlisted on the white swirl asset", () => {
    expect(MARKER_ICON.unlisted).toBe("/markers/hs-marker-white.png")
  })
})

describe("hsMarkerLayer", () => {
  it("puts a non-owned listing in the for-sale band", () => {
    expect(hsMarkerLayer("listing", false)).toBe("forSale")
  })
  it("puts a non-owned salon in the unlisted band", () => {
    expect(hsMarkerLayer("hsLocation", false)).toBe("unlistedHs")
  })
  it("puts anything owned in the owned band", () => {
    expect(hsMarkerLayer("listing", true)).toBe("owned")
    expect(hsMarkerLayer("hsLocation", true)).toBe("owned")
  })
})

describe("MARKER_Z_BASE", () => {
  it("stacks competitors on top and unlisted salons at the bottom", () => {
    expect(MARKER_Z_BASE.competitor).toBeGreaterThan(MARKER_Z_BASE.forSale)
    expect(MARKER_Z_BASE.forSale).toBeGreaterThan(MARKER_Z_BASE.owned)
    expect(MARKER_Z_BASE.owned).toBeGreaterThan(MARKER_Z_BASE.unlistedHs)
  })
})

describe("markerZIndex", () => {
  it("returns the base band as a style-ready string", () => {
    expect(markerZIndex("competitor")).toBe("40")
    expect(markerZIndex("unlistedHs")).toBe("10")
  })
  it("lifts a hovered marker above its own layer", () => {
    expect(Number(markerZIndex("owned", true))).toBeGreaterThan(
      Number(markerZIndex("owned"))
    )
  })
  it("never lets a hovered marker cross into the layer above", () => {
    // The whole point of 10-wide bands: hovering a for-sale pin must not
    // raise it over a competitor closure.
    expect(Number(markerZIndex("forSale", true))).toBeLessThan(
      MARKER_Z_BASE.competitor
    )
    expect(Number(markerZIndex("owned", true))).toBeLessThan(
      MARKER_Z_BASE.forSale
    )
    expect(Number(markerZIndex("unlistedHs", true))).toBeLessThan(
      MARKER_Z_BASE.owned
    )
  })
})
