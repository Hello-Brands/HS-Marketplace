import { describe, it, expect } from "vitest"
import { formatRating, starStates, formatReviewDate } from "@/lib/kpi/reviews-display"

describe("formatRating", () => {
  it("formats to two decimals", () => {
    expect(formatRating(4.8421)).toBe("4.84")
    expect(formatRating(5)).toBe("5.00")
  })
})

describe("starStates", () => {
  it("rounds to the nearest half star and always returns 5 entries", () => {
    expect(starStates(5)).toEqual(["full", "full", "full", "full", "full"])
    expect(starStates(4.84)).toEqual(["full", "full", "full", "full", "full"]) // rounds to 5.0
    expect(starStates(4.6)).toEqual(["full", "full", "full", "full", "half"]) // rounds to 4.5
    expect(starStates(4.2)).toEqual(["full", "full", "full", "full", "empty"]) // rounds to 4.0
    expect(starStates(3.5)).toEqual(["full", "full", "full", "half", "empty"])
    expect(starStates(0)).toEqual(["empty", "empty", "empty", "empty", "empty"])
  })
})

describe("formatReviewDate", () => {
  it("formats YYYY-MM-DD to 'Mon YYYY'", () => {
    expect(formatReviewDate("2026-06-20")).toBe("Jun 2026")
    expect(formatReviewDate("2025-01-05")).toBe("Jan 2025")
  })
  it("returns empty string for empty or malformed input", () => {
    expect(formatReviewDate("")).toBe("")
    expect(formatReviewDate("nonsense")).toBe("")
  })
})
