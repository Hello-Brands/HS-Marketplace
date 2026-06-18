import { describe, it, expect } from "vitest"
import { canFetchLiveData } from "@/lib/kpi/access"

describe("canFetchLiveData", () => {
  it("allows only active + confirmed", () => {
    expect(canFetchLiveData("active", "confirmed")).toBe(true)
  })
  it.each([
    ["draft", "confirmed"],
    ["pending", "confirmed"],
    ["sold", "confirmed"],
    ["active", "unconfirmed"],
    ["active", "not_connected"],
  ])("blocks %s / %s", (listing, mapping) => {
    expect(canFetchLiveData(listing, mapping)).toBe(false)
  })
})
