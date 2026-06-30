import { describe, it, expect } from "vitest"
import { listSections } from "@/lib/browse-list-sections"

describe("listSections", () => {
  it("shows both blocks when both layers on and competitors exist", () => {
    expect(listSections(true, true, true)).toEqual({ listings: true, competitors: true, empty: false })
  })
  it("shows only listings when only Hello Sugar is on", () => {
    expect(listSections(true, false, true)).toEqual({ listings: true, competitors: false, empty: false })
  })
  it("shows only competitors when only Competitors is on and data exists", () => {
    expect(listSections(false, true, true)).toEqual({ listings: false, competitors: true, empty: false })
  })
  it("is empty when neither layer is on", () => {
    expect(listSections(false, false, true)).toEqual({ listings: false, competitors: false, empty: true })
  })
  it("is empty when only Competitors is on but there is no competitor data", () => {
    expect(listSections(false, true, false)).toEqual({ listings: false, competitors: false, empty: true })
  })
  it("still shows listings when both on but no competitor data", () => {
    expect(listSections(true, true, false)).toEqual({ listings: true, competitors: false, empty: false })
  })
})
