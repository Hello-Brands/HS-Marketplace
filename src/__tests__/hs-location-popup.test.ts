import { describe, it, expect } from "vitest"
import { hsLocationPopupHtml } from "@/components/browse/hs-location-popup"
import type { UnlistedHsLocation } from "@/lib/hs-locations-filter"

const base: UnlistedHsLocation = {
  id: "loc-1",
  name: "Austin Domain",
  city: "Austin",
  state: "TX",
  latitude: 30.4,
  longitude: -97.72,
  openedSince: 2019,
  locationType: "suite",
}

describe("hsLocationPopupHtml", () => {
  it("includes the name, place, and open-since year", () => {
    const html = hsLocationPopupHtml(base)
    expect(html).toContain("Austin Domain")
    expect(html).toContain("Austin, TX")
    expect(html).toContain("Open since 2019")
  })

  it("marks the location as not for sale", () => {
    expect(hsLocationPopupHtml(base).toLowerCase()).toContain("not for sale")
  })

  it("omits the open-since line when the year is unknown", () => {
    expect(hsLocationPopupHtml({ ...base, openedSince: null })).not.toContain("Open since")
  })

  it("escapes HTML in the name to prevent injection", () => {
    const html = hsLocationPopupHtml({ ...base, name: "<img src=x onerror=alert(1)>" })
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img src=x")
  })

  it("never leaks owner PII fields (no @, no 'owner')", () => {
    const html = hsLocationPopupHtml(base).toLowerCase()
    expect(html).not.toContain("@")
    expect(html).not.toContain("owner")
  })

  it("shows a Suite chip for a suite-only location", () => {
    const html = hsLocationPopupHtml({ ...base, locationType: "suite" })
    expect(html).toContain(">Suite<")
    expect(html).not.toContain(">Flagship<")
  })

  it("shows a Flagship chip for a flagship-only location", () => {
    const html = hsLocationPopupHtml({ ...base, locationType: "flagship" })
    expect(html).toContain(">Flagship<")
    expect(html).not.toContain(">Suite<")
  })

  it("shows both chips for a dual-track location", () => {
    const html = hsLocationPopupHtml({ ...base, locationType: "both" })
    expect(html).toContain(">Suite<")
    expect(html).toContain(">Flagship<")
  })

  it("shows no type chip when the type is unknown", () => {
    const html = hsLocationPopupHtml({ ...base, locationType: null })
    expect(html).not.toContain(">Suite<")
    expect(html).not.toContain(">Flagship<")
  })

  it("keeps the type chip in the owned variant", () => {
    const html = hsLocationPopupHtml({ ...base, locationType: "flagship" }, true)
    expect(html).toContain("Your location")
    expect(html).toContain(">Flagship<")
  })

  it("owned variant shows the yours badge and both action buttons", () => {
    const html = hsLocationPopupHtml(base, true)
    expect(html).toContain("Your location")
    expect(html).toContain('data-hs-popup-action="view"')
    expect(html).toContain("View location")
    expect(html).toContain('data-hs-popup-action="watch"')
    expect(html).toContain("Watch this area")
  })

  it("default variant is unchanged (no action buttons, not-for-sale badge)", () => {
    const html = hsLocationPopupHtml(base)
    expect(html).toContain("not for sale")
    expect(html).not.toContain("data-hs-popup-action")
    expect(html).not.toContain("<button")
  })
})
