import { describe, it, expect } from "vitest"
import { LISTINGS_PAGE_SIZE, formatListingCount } from "@/lib/browse/listing-count"

describe("formatListingCount", () => {
  it("formats a count with no more pages", () => {
    expect(formatListingCount(7, false)).toBe("7")
  })

  it("appends a plus when more pages remain", () => {
    expect(formatListingCount(12, true)).toBe("12+")
  })

  it("formats a zero count with no more pages", () => {
    expect(formatListingCount(0, false)).toBe("0")
  })

  it("formats a zero count with more pages", () => {
    expect(formatListingCount(0, true)).toBe("0+")
  })
})

describe("LISTINGS_PAGE_SIZE", () => {
  it("is 12", () => {
    expect(LISTINGS_PAGE_SIZE).toBe(12)
  })
})
