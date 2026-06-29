import { describe, it, expect } from "vitest"
import { daysListed, shouldRecordView, nextListedAt } from "@/lib/analytics/helpers"

describe("daysListed", () => {
  it("is 0 for the same UTC day", () => {
    expect(daysListed(new Date("2026-06-29T01:00:00Z"), new Date("2026-06-29T23:00:00Z"))).toBe(0)
  })
  it("counts whole days across a boundary", () => {
    expect(daysListed(new Date("2026-06-17T12:00:00Z"), new Date("2026-06-29T00:00:00Z"))).toBe(12)
  })
  it("never returns negative", () => {
    expect(daysListed(new Date("2026-06-29T00:00:00Z"), new Date("2026-06-17T00:00:00Z"))).toBe(0)
  })
})

describe("shouldRecordView", () => {
  it("counts an ordinary viewer", () => {
    expect(shouldRecordView({ viewerId: "u1", sellerId: "s1", viewerRole: "user" })).toBe(true)
  })
  it("skips the listing's own seller", () => {
    expect(shouldRecordView({ viewerId: "s1", sellerId: "s1", viewerRole: "user" })).toBe(false)
  })
  it("skips admins", () => {
    expect(shouldRecordView({ viewerId: "u2", sellerId: "s1", viewerRole: "admin" })).toBe(false)
  })
})

describe("nextListedAt", () => {
  const now = new Date("2026-06-29T00:00:00Z")
  it("sets the timestamp when first activating", () => {
    expect(nextListedAt(null, "active", now)).toEqual(now)
  })
  it("does not overwrite an existing timestamp on re-activation", () => {
    const earlier = new Date("2026-01-01T00:00:00Z")
    expect(nextListedAt(earlier, "active", now)).toEqual(earlier)
  })
  it("leaves it untouched for non-active transitions", () => {
    expect(nextListedAt(null, "delisted", now)).toBeNull()
  })
})
