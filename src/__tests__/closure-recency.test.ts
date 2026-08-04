import { describe, it, expect } from "vitest"
import {
  NEW_CLOSURE_WINDOW_DAYS,
  CLOSURE_DETECTED_TIMEZONE,
  isNewClosure,
  formatClosureDetected,
} from "@/lib/closure-recency"

const NOW = new Date("2026-08-04T12:00:00.000Z")
const daysBefore = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString()

describe("NEW_CLOSURE_WINDOW_DAYS", () => {
  it("is the agreed 14-day window", () => {
    expect(NEW_CLOSURE_WINDOW_DAYS).toBe(14)
  })
})

describe("isNewClosure", () => {
  it("flags a closure detected today", () => {
    expect(isNewClosure(daysBefore(0), NOW)).toBe(true)
  })
  it("flags a closure just inside the window", () => {
    expect(isNewClosure(daysBefore(13.9), NOW)).toBe(true)
  })
  it("flags a closure exactly on the window boundary", () => {
    expect(isNewClosure(daysBefore(14), NOW)).toBe(true)
  })
  it("does not flag a closure just outside the window", () => {
    expect(isNewClosure(daysBefore(14.1), NOW)).toBe(false)
  })
  it("does not flag an old closure", () => {
    expect(isNewClosure(daysBefore(120), NOW)).toBe(false)
  })
  it("never flags a null closedAt", () => {
    // 22 of 79 production rows have no closed_at. We do not claim recency
    // we don't know.
    expect(isNewClosure(null, NOW)).toBe(false)
  })
  it("never flags an unparseable date, and does not throw", () => {
    expect(() => isNewClosure("not a date", NOW)).not.toThrow()
    expect(isNewClosure("not a date", NOW)).toBe(false)
  })
  it("never flags an empty string", () => {
    expect(isNewClosure("", NOW)).toBe(false)
  })
  it("still flags a slightly future timestamp (scraper clock skew)", () => {
    const skewed = new Date(NOW.getTime() + 30_000).toISOString()
    expect(isNewClosure(skewed, NOW)).toBe(true)
  })
})

describe("formatClosureDetected", () => {
  it("formats a detection timestamp as the approved sentence", () => {
    // 18:00Z on Jun 22 is midday Jun 22 in Denver — pins the exact copy+format.
    expect(formatClosureDetected("2026-06-22T18:00:00.000Z")).toBe(
      "Closure detected Jun 22, 2026"
    )
  })

  it("formats in America/Denver, not UTC", () => {
    // A real production value. 04:44Z on Jun 22 is 22:44 on Jun 21 in Denver,
    // so a UTC-based implementation would say "Jun 22" and fail here.
    expect(formatClosureDetected("2026-06-22T04:44:29.680Z")).toBe(
      "Closure detected Jun 21, 2026"
    )
  })

  it("accepts a Date as well as an ISO string", () => {
    // The favorites page gets a Date from the Drizzle driver.
    expect(formatClosureDetected(new Date("2026-06-22T18:00:00.000Z"))).toBe(
      "Closure detected Jun 22, 2026"
    )
  })

  it("returns null for a null date so the caller omits the line", () => {
    // 22 of 79 production rows have no closed_at.
    expect(formatClosureDetected(null)).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(formatClosureDetected("")).toBeNull()
  })

  it("returns null for an unparseable date, and does not throw", () => {
    expect(() => formatClosureDetected("not a date")).not.toThrow()
    expect(formatClosureDetected("not a date")).toBeNull()
  })

  it("returns null for an invalid Date object", () => {
    expect(formatClosureDetected(new Date("nonsense"))).toBeNull()
  })

  it("exposes the timezone it formats in", () => {
    expect(CLOSURE_DETECTED_TIMEZONE).toBe("America/Denver")
  })
})
