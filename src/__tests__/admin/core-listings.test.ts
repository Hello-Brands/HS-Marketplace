import { describe, it, expect, vi, beforeEach } from "vitest"

const { findFirst, update, updateSetCalls, withAudit } = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = []
  return {
    findFirst: vi.fn(),
    updateSetCalls,
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    withAudit: vi.fn(
      async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, fn: () => Promise<unknown>) => ({
        result: await fn(),
        auditId: "audit-1",
      }),
    ),
  }
})

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
// core/listings.ts unconditionally imports @/lib/listings/persist, which pulls in
// @/lib/owner-directory/data.ts -> @/auth. Real next-auth can't load under this
// vitest config (see every other test that touches owner-directory data), so it
// must be mocked even though adminMarkSold never calls auth() itself.
vi.mock("@/auth", () => ({ auth: vi.fn() }))
// Same transitive chain (persist.ts) pulls in bigquery/queries.ts, which calls
// unstable_cache(...) from next/cache at module load time; stub it offline like
// the sibling write-path tests do.
vi.mock("@/lib/bigquery/queries", () => ({
  getNetSalesByLocation: vi.fn().mockResolvedValue(new Map()),
  getMcrByLocation: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/lib/email", () => ({ sendStatusChangeEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/alerts/matching", () => ({ triggerAlertMatching: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/db", () => ({
  db: {
    update: update,
    query: { listings: { findFirst } },
  },
}))

import { adminMarkSold } from "@/lib/admin/core/listings"

const actor = { userId: "admin-1", source: "ui" as const }

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
})

describe("core adminMarkSold", () => {
  it("throws when the listing is missing (no audit-free path)", async () => {
    findFirst.mockResolvedValue(undefined)
    await expect(adminMarkSold(actor, "nope")).rejects.toThrow("Listing not found")
    expect(withAudit).toHaveBeenCalledWith(actor, "listing.mark_sold", { type: "listing", id: "nope" }, { listingId: "nope" }, expect.any(Function))
  })

  it("marks an active listing sold and returns the audit id", async () => {
    findFirst.mockResolvedValue({ id: "l1", status: "active" })
    const out = await adminMarkSold(actor, "l1")
    expect(out).toEqual({ success: true, auditId: "audit-1" })
    expect(updateSetCalls[0]).toMatchObject({ status: "sold" })
  })

  it("refuses an illegal transition", async () => {
    findFirst.mockResolvedValue({ id: "l1", status: "draft" })
    await expect(adminMarkSold(actor, "l1")).rejects.toThrow(/Cannot mark listing as sold/)
    expect(update).not.toHaveBeenCalled()
  })
})
