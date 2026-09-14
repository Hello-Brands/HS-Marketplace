import { describe, it, expect, vi, beforeEach } from "vitest"

const { findFirst, update, updateSetCalls, dispatch, withAudit } = vi.hoisted(() => {
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
    dispatch: vi.fn(),
    withAudit: vi.fn(
      async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, fn: () => Promise<unknown>) => ({
        result: await fn(),
        auditId: "audit-1",
      }),
    ),
  }
})

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/lib/brand-requests/dispatch", () => ({ dispatchMonitorEvent: dispatch }))
vi.mock("@/db", () => ({
  db: { update, query: { brandRequests: { findFirst } } },
}))

import { approveBrandRequest, rejectBrandRequest } from "@/lib/admin/core/brand-requests"

const actor = { userId: "admin-1", source: "mcp" as const, clientId: "claude-code", tokenId: "t1" }

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
})

describe("core approveBrandRequest", () => {
  it("approves a recon_complete request, stamping decidedBy from the actor", async () => {
    findFirst.mockResolvedValue({ id: "r1", status: "recon_complete" })
    dispatch.mockResolvedValue({ ok: true })
    expect(await approveBrandRequest(actor, "r1")).toEqual({ success: true, dispatched: true, auditId: "audit-1" })
    expect(updateSetCalls[0]).toMatchObject({ status: "approved", decidedBy: "admin-1" })
    expect(dispatch).toHaveBeenCalledWith("brand-build", "r1")
  })

  it("refuses to approve before recon without the override", async () => {
    findFirst.mockResolvedValue({ id: "r1", status: "submitted" })
    await expect(approveBrandRequest(actor, "r1")).rejects.toThrow(/Recon has not completed/)
    expect(update).not.toHaveBeenCalled()
  })
})

describe("core rejectBrandRequest", () => {
  it("requires a reason", async () => {
    findFirst.mockResolvedValue({ id: "r1", status: "submitted" })
    await expect(rejectBrandRequest(actor, "r1", "   ")).rejects.toThrow("A rejection reason is required.")
  })

  it("rejects and records the reason", async () => {
    findFirst.mockResolvedValue({ id: "r1", status: "submitted" })
    expect(await rejectBrandRequest(actor, "r1", "Not a fit")).toEqual({ success: true, auditId: "audit-1" })
    expect(updateSetCalls[0]).toMatchObject({ status: "rejected", rejectReason: "Not a fit", decidedBy: "admin-1" })
  })
})
