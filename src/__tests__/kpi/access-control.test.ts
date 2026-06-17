import { describe, it, expect } from "vitest"
import { canFetchBoulevard } from "@/lib/kpi/access"

describe("canFetchBoulevard", () => {
  it("allows only active + confirmed", () => {
    expect(canFetchBoulevard("active", "confirmed")).toBe(true)
  })
  it.each([
    ["draft", "confirmed"],
    ["pending", "confirmed"],
    ["sold", "confirmed"],
    ["active", "unconfirmed"],
    ["active", "not_connected"],
  ])("blocks %s / %s", (listing, mapping) => {
    expect(canFetchBoulevard(listing, mapping)).toBe(false)
  })
})
