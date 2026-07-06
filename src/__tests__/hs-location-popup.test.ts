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
})
