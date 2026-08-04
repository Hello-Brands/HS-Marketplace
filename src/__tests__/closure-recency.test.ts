import { describe, it, expect } from "vitest"
import { NEW_CLOSURE_WINDOW_DAYS, isNewClosure } from "@/lib/closure-recency"

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
