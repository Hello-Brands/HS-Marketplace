import { describe, it, expect, vi } from "vitest"

// Mock server-only to be a no-op in tests
vi.mock("server-only", () => ({}))

import {
  pickFeaturedReview,
  rowsToReviewSummaryByLocation,
  type FeaturedReview,
} from "@/lib/bigquery/queries"

const review = (over: Partial<FeaturedReview>): FeaturedReview => ({
  reviewerName: "Jane",
  rating: 5,
  date: "2026-01-01",
  comment: "x".repeat(200),
  ownerReplied: false,
  ...over,
})

describe("pickFeaturedReview", () => {
  it("returns null when there are no comment-bearing candidates", () => {
    expect(pickFeaturedReview([])).toBeNull()
    expect(pickFeaturedReview([review({ comment: "   " })])).toBeNull()
  })

  it("prefers a comment inside the 120-600 char window over a longer one", () => {
    const long = review({ comment: "a".repeat(1000), date: "2026-05-01" })
    const windowed = review({ comment: "b".repeat(200), date: "2026-01-01" })
    expect(pickFeaturedReview([long, windowed]).comment).toBe("b".repeat(200))
  })

  it("prefers owner-replied among same rating and both in window", () => {
    const notReplied = review({ comment: "c".repeat(200), ownerReplied: false, date: "2026-05-01" })
    const replied = review({ comment: "d".repeat(200), ownerReplied: true, date: "2026-01-01" })
    expect(pickFeaturedReview([notReplied, replied]).ownerReplied).toBe(true)
  })

  it("falls back to a short comment when none fall in the length window", () => {
    const short = review({ comment: "Great!", date: "2026-02-02" })
    expect(pickFeaturedReview([short]).comment).toBe("Great!")
  })

  it("breaks ties by recency (most recent wins)", () => {
    const older = review({ comment: "e".repeat(200), date: "2026-01-01" })
    const newer = review({ comment: "f".repeat(200), date: "2026-06-01" })
    expect(pickFeaturedReview([older, newer]).date).toBe("2026-06-01")
  })

  it("prefers higher rating before anything else", () => {
    const five = review({ rating: 5, comment: "g".repeat(50), date: "2026-01-01" })
    const four = review({ rating: 4, comment: "h".repeat(200), date: "2026-06-01" })
    expect(pickFeaturedReview([five, four]).rating).toBe(5)
  })
})

describe("rowsToReviewSummaryByLocation", () => {
  const baseRow = {
    LOCATION_NAME: "AZ Peoria | Park West 007",
    avg_rating: 4.84,
    total_reviews: 1516,
    c5: 1420,
    c4: 34,
    c3: 15,
    c2: 16,
    c1: 31,
    REVIEWER_DISPLAY_NAME: "Jordan Brown",
    NUMERIC_STAR_RATING: 5,
    COMMENT: "z".repeat(200),
    create_date: "2026-06-20",
    REPLIED: true,
  }

  it("filters out rows with a null LOCATION_NAME", () => {
    const map = rowsToReviewSummaryByLocation([{ ...baseRow, LOCATION_NAME: null }])
    expect(map.size).toBe(0)
  })

  it("computes avg, total, and a descending 5..1 distribution", () => {
    const map = rowsToReviewSummaryByLocation([baseRow])
    const s = map.get("AZ Peoria | Park West 007")!
    expect(s.avgRating).toBeCloseTo(4.84)
    expect(s.totalReviews).toBe(1516)
    expect(s.distribution).toEqual([
      { stars: 5, count: 1420 },
      { stars: 4, count: 34 },
      { stars: 3, count: 15 },
      { stars: 2, count: 16 },
      { stars: 1, count: 31 },
    ])
  })

  it("selects a featured review from the candidate rows", () => {
    const map = rowsToReviewSummaryByLocation([baseRow])
    const s = map.get("AZ Peoria | Park West 007")!
    expect(s.featured?.reviewerName).toBe("Jordan Brown")
    expect(s.featured?.ownerReplied).toBe(true)
  })

  it("sets featured to null when no candidate row has a comment", () => {
    const map = rowsToReviewSummaryByLocation([{ ...baseRow, COMMENT: null }])
    expect(map.get("AZ Peoria | Park West 007")!.featured).toBeNull()
  })

  it("groups multiple locations independently", () => {
    const other = { ...baseRow, LOCATION_NAME: "TX Houston | Heights 017", total_reviews: 1612 }
    const map = rowsToReviewSummaryByLocation([baseRow, other])
    expect(map.size).toBe(2)
    expect(map.get("TX Houston | Heights 017")!.totalReviews).toBe(1612)
  })
})
