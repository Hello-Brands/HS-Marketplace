import { describe, it, expect, vi } from "vitest"

// Mock server-side deps so the "use server" file can be imported in node env
vi.mock("@/auth", () => ({ auth: vi.fn() }))
vi.mock("@/db", () => ({ db: {} }))

import { fillTrend } from "@/app/admin/analytics/actions"

describe("fillTrend", () => {
  const today = new Date("2026-06-29T12:00:00Z")
  it("returns one point per day, oldest first, ending today", () => {
    const out = fillTrend([], 30, today)
    expect(out).toHaveLength(30)
    expect(out[29].date).toBe("2026-06-29")
    expect(out[0].date).toBe("2026-05-31")
    expect(out.every((p) => p.count === 0)).toBe(true)
  })
  it("maps known counts onto their dates and zero-fills the rest", () => {
    const out = fillTrend([{ date: "2026-06-29", count: 5 }, { date: "2026-06-27", count: 2 }], 30, today)
    expect(out.find((p) => p.date === "2026-06-29")!.count).toBe(5)
    expect(out.find((p) => p.date === "2026-06-27")!.count).toBe(2)
    expect(out.find((p) => p.date === "2026-06-28")!.count).toBe(0)
  })
})
