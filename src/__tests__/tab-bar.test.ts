import { describe, it, expect } from "vitest"
import { tabBarHiddenForPath } from "@/lib/tab-bar"

describe("tabBarHiddenForPath", () => {
  it("shows the tab bar on marketplace surfaces", () => {
    expect(tabBarHiddenForPath("/browse")).toBe(false)
    expect(tabBarHiddenForPath("/account/favorites")).toBe(false)
    expect(tabBarHiddenForPath("/account/alerts")).toBe(false)
    expect(tabBarHiddenForPath("/seller/listings")).toBe(false)
  })

  it("hides on listing detail (it has its own fixed contact CTA bar)", () => {
    expect(tabBarHiddenForPath("/listings/abc-123")).toBe(true)
    expect(tabBarHiddenForPath("/listings/abc-123/inquire")).toBe(true)
  })
})
