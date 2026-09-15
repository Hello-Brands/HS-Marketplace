import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const { select, getAnalyticsSummary } = vi.hoisted(() => ({
  select: vi.fn(),
  getAnalyticsSummary: vi.fn(),
}))

vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))
vi.mock("@/lib/admin/core/analytics", () => ({ getAnalyticsSummary }))

import { marketplaceOverview } from "@/lib/mcp/queries/overview"

describe("marketplaceOverview", () => {
  beforeEach(() => {
    select.mockReset()
    getAnalyticsSummary.mockReset().mockResolvedValue({
      totalUsers: 42,
      activeThisWeek: 7,
      logins30d: 120,
      inquiries30d: 9,
    })
    // Call order must match the Promise.all array in the implementation:
    // 1 listings-by-status, 2 brand-requests-by-status, 3 admins, 4 seller access,
    // 5 allowlist, 6 inquiries 7d, 7 logins 7d.
    select
      .mockReturnValueOnce(
        builder([
          { status: "active", n: 12 },
          { status: "pending", n: 3 },
          { status: "draft", n: 5 },
        ]),
      )
      .mockReturnValueOnce(
        builder([
          { status: "submitted", n: 2 },
          { status: "rejected", n: 4 },
          { status: "live", n: 1 },
        ]),
      )
      .mockReturnValueOnce(builder([{ n: 2 }]))
      .mockReturnValueOnce(builder([{ n: 6 }]))
      .mockReturnValueOnce(builder([{ n: 11 }]))
      .mockReturnValueOnce(builder([{ n: 4 }]))
      .mockReturnValueOnce(builder([{ n: 31 }]))
  })

  it("totals listings and keeps the per-status breakdown", async () => {
    const o = await marketplaceOverview()
    expect(o.listings.total).toBe(20)
    expect(o.listings.by_status).toEqual({ active: 12, pending: 3, draft: 5 })
  })

  it("surfaces the pending approval queue as its own number", async () => {
    expect((await marketplaceOverview()).pending_queue).toBe(3)
  })

  it("counts only undecided brand requests as open", async () => {
    // rejected and live are decided; submitted is not.
    const o = await marketplaceOverview()
    expect(o.brand_requests.open).toBe(2)
    expect(o.brand_requests.by_status).toEqual({ submitted: 2, rejected: 4, live: 1 })
  })

  it("reuses getAnalyticsSummary rather than recounting users and 30d activity", async () => {
    const o = await marketplaceOverview()
    expect(getAnalyticsSummary).toHaveBeenCalledTimes(1)
    expect(o.users.total).toBe(42)
    expect(o.engagement.active_users_7d).toBe(7)
    expect(o.engagement.logins_30d).toBe(120)
    expect(o.engagement.inquiries_30d).toBe(9)
  })

  it("adds the counts the analytics summary does not carry", async () => {
    const o = await marketplaceOverview()
    expect(o.users).toMatchObject({ admins: 2, seller_access: 6, allowlist_entries: 11 })
    expect(o.engagement).toMatchObject({ inquiries_7d: 4, logins_7d: 31 })
  })

  it("reports zeroes rather than throwing when a count comes back empty", async () => {
    select.mockReset()
    select
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
    const o = await marketplaceOverview()
    expect(o.listings).toEqual({ total: 0, by_status: {} })
    expect(o.brand_requests).toEqual({ open: 0, by_status: {} })
    expect(o.users.admins).toBe(0)
  })
})
