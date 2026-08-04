import { describe, it, expect } from "vitest"
import { listSections } from "@/lib/browse-list-sections"

describe("listSections", () => {
  it("shows both blocks when both layers on and competitors exist", () => {
    expect(listSections(true, true, true)).toEqual({
      listings: true, competitors: true, empty: false, collapsibleListings: true,
    })
  })
  it("shows only listings when only Hello Sugar is on", () => {
    expect(listSections(true, false, true)).toEqual({
      listings: true, competitors: false, empty: false, collapsibleListings: false,
    })
  })
  it("shows only competitors when only Competitors is on and data exists", () => {
    expect(listSections(false, true, true)).toEqual({
      listings: false, competitors: true, empty: false, collapsibleListings: false,
    })
  })
  it("is empty when neither layer is on", () => {
    expect(listSections(false, false, true)).toEqual({
      listings: false, competitors: false, empty: true, collapsibleListings: false,
    })
  })
  it("is empty when only Competitors is on but there is no competitor data", () => {
    expect(listSections(false, true, false)).toEqual({
      listings: false, competitors: false, empty: true, collapsibleListings: false,
    })
  })
  it("still shows listings when both on but no competitor data", () => {
    expect(listSections(true, true, false)).toEqual({
      listings: true, competitors: false, empty: false, collapsibleListings: false,
    })
  })
})

describe("listSections collapsibleListings", () => {
  it("allows collapsing only when a competitor block is also rendering", () => {
    expect(listSections(true, true, true).collapsibleListings).toBe(true)
  })
  it("never collapses when the competitor layer is toggled off", () => {
    // Otherwise the page would open to a collapsed header and nothing else.
    expect(listSections(true, false, true).collapsibleListings).toBe(false)
  })
  it("never collapses when there is no competitor data at all", () => {
    expect(listSections(true, true, false).collapsibleListings).toBe(false)
  })
  it("never marks a non-rendering listings block collapsible", () => {
    expect(listSections(false, true, true).collapsibleListings).toBe(false)
  })
})
