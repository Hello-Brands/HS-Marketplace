import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const { select, listAuditLog } = vi.hoisted(() => ({
  select: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog }))

import { listingExtras } from "@/lib/mcp/queries/listings"

const auditRow = {
  id: "a-1",
  at: "2026-09-01T00:00:00.000Z",
  action: "listing.approve",
  source: "ui",
  actor: { id: "u-1", name: "Dana", email: "dana@example.com" },
  client_id: null,
  target: { type: "listing", id: "l-1" },
  outcome: "success",
  error: null,
  duration_ms: 12,
  args: null,
}

describe("listingExtras", () => {
  beforeEach(() => {
    select.mockReset()
    listAuditLog.mockReset().mockResolvedValue({ items: [auditRow], next_cursor: null })
    // Call order must match the Promise.all array in the implementation:
    // 1 recent inquiries, 2 distinct viewers, 3 the listing's view counter.
    select
      .mockReturnValueOnce(
        builder([
          {
            id: "c-1",
            createdAt: new Date("2026-08-20T10:00:00.000Z"),
            buyerName: "Sam",
            buyerEmail: "sam@example.com",
            buyerPhone: null,
            message: "Is the laser included?",
          },
        ]),
      )
      .mockReturnValueOnce(builder([{ n: 9 }]))
      .mockReturnValueOnce(builder([{ n: 12 }]))
  })

  it("shapes the recent inquiries with ISO timestamps and snake_case keys", async () => {
    const extras = await listingExtras("l-1")
    expect(extras.recent_inquiries).toEqual([
      {
        id: "c-1",
        at: "2026-08-20T10:00:00.000Z",
        buyer_name: "Sam",
        buyer_email: "sam@example.com",
        buyer_phone: null,
        message: "Is the laser included?",
      },
    ])
  })

  it("reports the denormalised counter and the distinct viewers separately", async () => {
    expect((await listingExtras("l-1")).views).toEqual({ counter: 12, distinct_viewers: 9 })
  })

  it("defaults both view numbers to 0 when the listing has no rows", async () => {
    select.mockReset()
    select
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
      .mockReturnValueOnce(builder([]))
    expect((await listingExtras("l-1")).views).toEqual({ counter: 0, distinct_viewers: 0 })
  })

  it("asks the audit log for this listing's rows, reads included", async () => {
    const extras = await listingExtras("l-1")
    expect(listAuditLog).toHaveBeenCalledWith({
      targetType: "listing",
      targetId: "l-1",
      includeReads: true,
      limit: 20,
    })
    expect(extras.audit_history).toEqual([auditRow])
  })
})
