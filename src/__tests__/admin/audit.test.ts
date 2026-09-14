import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

const { insert, captureException } = vi.hoisted(() => ({
  insert: vi.fn(),
  captureException: vi.fn(),
}))
vi.mock("@/db", () => ({ db: { insert: (...a: unknown[]) => insert(...a) } }))
vi.mock("@sentry/nextjs", () => ({ captureException }))

import { withAudit, recordMcpRead, redactAuditArgs } from "@/lib/admin/audit"
import { adminAuditLog } from "@/db/schema/adminAuditLog"

const actor = { userId: "admin-1", source: "ui" as const }

describe("redactAuditArgs", () => {
  it("replaces message/notes/body keys and truncates long strings", () => {
    const long = "x".repeat(3000)
    expect(
      redactAuditArgs({ id: "l1", message: "hi", nested: { notes: "n", body: "b", keep: long } }),
    ).toEqual({
      id: "l1",
      message: "[redacted]",
      nested: { notes: "[redacted]", body: "[redacted]", keep: "x".repeat(2048) + "…[truncated]" },
    })
  })

  it("passes primitives and arrays through", () => {
    expect(redactAuditArgs(["a", 1, null])).toEqual(["a", 1, null])
    expect(redactAuditArgs(undefined)).toBeUndefined()
  })
})

describe("withAudit", () => {
  let insertBuilder: ChainedBuilder
  beforeEach(() => {
    insert.mockReset()
    captureException.mockReset()
    insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)
  })

  it("records an ok row and returns the result + auditId", async () => {
    const out = await withAudit(actor, "listing.approve", { type: "listing", id: "l1" }, { listingId: "l1" }, async () => ({ success: true }))
    expect(out.result).toEqual({ success: true })
    expect(typeof out.auditId).toBe("string")
    expect(insert).toHaveBeenCalledWith(adminAuditLog)
    expect(insertBuilder.calls.values[0][0]).toMatchObject({
      id: out.auditId,
      actorUserId: "admin-1",
      source: "ui",
      action: "listing.approve",
      targetType: "listing",
      targetId: "l1",
      args: { listingId: "l1" },
      outcome: "ok",
      error: null,
    })
  })

  it("records an error row and rethrows when fn throws", async () => {
    await expect(
      withAudit(actor, "user.remove", { type: "user", id: "u9" }, {}, async () => {
        throw new Error("Cannot remove the last admin")
      }),
    ).rejects.toThrow("Cannot remove the last admin")
    expect(insertBuilder.calls.values[0][0]).toMatchObject({
      outcome: "error",
      error: "Cannot remove the last admin",
    })
  })

  it("treats an { ok:false, error } result as an error outcome without throwing", async () => {
    const out = await withAudit(actor, "allowlist.add", { type: "allowlist", id: null }, { raw: "x" }, async () => ({ ok: false as const, error: "Invalid" }))
    expect(out.result).toEqual({ ok: false, error: "Invalid" })
    expect(insertBuilder.calls.values[0][0]).toMatchObject({ outcome: "error", error: "Invalid" })
  })

  it("never lets an audit insert failure break the action", async () => {
    insert.mockImplementation(() => {
      throw new Error("db down")
    })
    const out = await withAudit(actor, "listing.approve", null, {}, async () => "done")
    expect(out.result).toBe("done")
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it("also survives an async rejection from the insert", async () => {
    const values = vi.fn().mockRejectedValue(new Error("db down (async)"))
    insert.mockReset().mockReturnValue({ values })
    const out = await withAudit(actor, "listing.approve", null, {}, async () => "done")
    expect(out.result).toBe("done")
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it("does not let a hostile args object break the action", async () => {
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    const b = builder(undefined)
    insert.mockReset().mockReturnValue(b)
    const out = await withAudit(actor, "listing.approve", null, cyclic, async () => "ok")
    expect(out.result).toBe("ok")
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("carries mcp client/token ids", async () => {
    await withAudit({ userId: "a", source: "mcp", clientId: "claude-code", tokenId: "t1" }, "listing.approve", null, {}, async () => 1)
    expect(insertBuilder.calls.values[0][0]).toMatchObject({ source: "mcp", mcpClientId: "claude-code", mcpTokenId: "t1" })
  })
})

describe("recordMcpRead", () => {
  it("writes an mcp.read row with the tool and filters", async () => {
    const b = builder(undefined)
    insert.mockReset().mockReturnValue(b)
    const id = await recordMcpRead({ userId: "a", source: "mcp", clientId: "c", tokenId: "t" }, "list_listings", { status: "pending" })
    expect(typeof id).toBe("string")
    expect(b.calls.values[0][0]).toMatchObject({
      action: "mcp.read",
      source: "mcp",
      args: { tool: "list_listings", filters: { status: "pending" } },
      outcome: "ok",
    })
  })
})
