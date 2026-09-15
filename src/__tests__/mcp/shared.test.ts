import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { recordMcpRead, recordMcpPreview, captureException } = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  recordMcpPreview: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead, recordMcpPreview }))
vi.mock("@sentry/nextjs", () => ({ captureException }))

import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  WRITE_LIMIT_PER_MINUTE,
  toolContext,
  encodeCursor,
  decodeCursor,
  paginateArray,
  money,
  toolResult,
  toolError,
  isExpectedToolError,
  readTool,
  writeTool,
  deletedTarget,
  READ_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
} from "@/lib/mcp/tools/_shared"
import { __resetRateLimits } from "@/lib/rate-limit"

const MCP = {
  userId: "u-1",
  email: "admin@hellosugar.salon",
  scopes: ["marketplace:read", "marketplace:write"],
  clientId: "claude-code",
  tokenId: "tok-1",
}

describe("toolContext", () => {
  it("maps an McpActor onto an mcp-sourced AdminActor", () => {
    const ctx = toolContext(MCP)
    expect(ctx.actor).toEqual({
      userId: "u-1",
      source: "mcp",
      clientId: "claude-code",
      tokenId: "tok-1",
    })
    expect(ctx.canWrite).toBe(true)
  })

  it("is read-only when the token lacks marketplace:write", () => {
    expect(toolContext({ ...MCP, scopes: ["marketplace:read"] }).canWrite).toBe(false)
  })
})

describe("cursor codec", () => {
  it("round-trips a payload through an opaque string", () => {
    const c = encodeCursor({ o: 50 })
    expect(c).not.toContain("{")
    expect(c).not.toMatch(/[+/=]/) // base64url, not base64
    expect(decodeCursor(c)).toEqual({ o: 50 })
  })

  it("returns null for an absent cursor", () => {
    expect(decodeCursor(undefined)).toBeNull()
  })

  it("returns null rather than throwing for a garbage cursor", () => {
    expect(() => decodeCursor("not-a-cursor")).not.toThrow()
    expect(decodeCursor("not-a-cursor")).toBeNull()
  })
})

describe("paginateArray", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}` }))

  it("defaults to 25 items and hands back a cursor", () => {
    const page = paginateArray(rows, undefined, undefined)
    expect(page.items).toHaveLength(DEFAULT_LIMIT)
    expect(page.items[0].id).toBe("r0")
    expect(page.next_cursor).not.toBeNull()
  })

  it("resumes exactly where the previous page stopped", () => {
    const first = paginateArray(rows, 10, undefined)
    const second = paginateArray(rows, 10, first.next_cursor!)
    expect(second.items[0].id).toBe("r10")
  })

  it("ends with a null cursor on the last page", () => {
    const page = paginateArray(rows, 100, undefined)
    expect(page.items).toHaveLength(30)
    expect(page.next_cursor).toBeNull()
  })

  it("clamps a limit above the maximum", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}` }))
    expect(paginateArray(many, 1000, undefined).items).toHaveLength(MAX_LIMIT)
  })

  it("treats a garbage cursor as the first page", () => {
    expect(paginateArray(rows, 5, "garbage").items[0].id).toBe("r0")
  })
})

describe("money", () => {
  it("returns cents alongside the shared formatter's output", () => {
    expect(money(12345600)).toEqual({ cents: 12345600, formatted: "$123,456" })
  })

  it("returns null for a missing amount so callers omit the field", () => {
    expect(money(null)).toBeNull()
    expect(money(undefined)).toBeNull()
  })

  it("keeps zero as a real value, not a missing one", () => {
    expect(money(0)).toEqual({ cents: 0, formatted: "$0" })
  })
})

describe("toolResult / toolError", () => {
  it("emits compact JSON text plus structuredContent", () => {
    const r = toolResult({ ok: true, n: 1 })
    expect(r.structuredContent).toEqual({ ok: true, n: 1 })
    expect(r.content).toEqual([{ type: "text", text: '{"ok":true,"n":1}' }])
    expect(r.isError).toBeUndefined()
  })

  it("emits an isError result carrying the message in both channels", () => {
    const r = toolError("Cannot demote the last admin")
    expect(r.isError).toBe(true)
    expect(r.content).toEqual([{ type: "text", text: "Cannot demote the last admin" }])
    expect(r.structuredContent).toEqual({ error: "Cannot demote the last admin" })
  })
})

describe("isExpectedToolError", () => {
  it("accepts a plain Error — the convention core mutations throw", () => {
    expect(isExpectedToolError(new Error("Listing not found"))).toBe(true)
  })

  it("rejects an Error subclass, which signals a bug or infrastructure failure", () => {
    expect(isExpectedToolError(new TypeError("x is not a function"))).toBe(false)
    class NeonDbError extends Error {
      name = "NeonDbError"
    }
    expect(isExpectedToolError(new NeonDbError("connection terminated"))).toBe(false)
  })

  it("rejects a thrown non-Error", () => {
    expect(isExpectedToolError("boom")).toBe(false)
  })
})

describe("readTool", () => {
  beforeEach(() => {
    recordMcpRead.mockReset().mockResolvedValue("audit-1")
    captureException.mockReset()
  })

  it("audits the read and returns the payload", async () => {
    const r = await readTool(toolContext(MCP), "list_listings", { status: "pending" }, async () => ({
      items: [],
      next_cursor: null,
    }))
    expect(recordMcpRead).toHaveBeenCalledWith(toolContext(MCP).actor, "list_listings", {
      status: "pending",
    })
    expect(r.structuredContent).toEqual({ items: [], next_cursor: null })
  })

  it("surfaces a plain Error's message verbatim without Sentry", async () => {
    const r = await readTool(toolContext(MCP), "get_listing", {}, async () => {
      throw new Error("Listing not found")
    })
    expect(r.isError).toBe(true)
    expect(r.content[0]).toEqual({ type: "text", text: "Listing not found" })
    expect(captureException).not.toHaveBeenCalled()
  })

  it("sends an unexpected failure to Sentry and returns a reference", async () => {
    const r = await readTool(toolContext(MCP), "get_listing", {}, async () => {
      throw new TypeError("rows.map is not a function")
    })
    expect(captureException).toHaveBeenCalledTimes(1)
    const text = (r.content[0] as { text: string }).text
    expect(text).toMatch(/^Unexpected error \(ref [0-9a-f-]{36}\)$/)
    // The same reference is tagged on the Sentry event so an operator can find it.
    const ref = text.slice("Unexpected error (ref ".length, -1)
    expect(captureException.mock.calls[0][1]).toMatchObject({ tags: { mcp_ref: ref } })
  })

  it("never lets an audit-write failure block the read", async () => {
    recordMcpRead.mockRejectedValue(new Error("audit table unavailable"))
    const r = await readTool(toolContext(MCP), "list_users", {}, async () => ({ items: [] }))
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent).toEqual({ items: [] })
  })
})

describe("writeTool", () => {
  beforeEach(() => {
    __resetRateLimits()
    captureException.mockReset()
    recordMcpPreview.mockReset().mockResolvedValue("audit-preview")
  })

  it("returns the payload and does not write an mcp.read row", async () => {
    recordMcpRead.mockReset()
    const r = await writeTool(
      toolContext(MCP),
      "approve_listing",
      { listing_id: "l1" },
      async () => ({
        audit_id: "a1",
        target: { id: "l1" },
      }),
    )
    expect(r.structuredContent).toEqual({ audit_id: "a1", target: { id: "l1" } })
    expect(recordMcpRead).not.toHaveBeenCalled()
  })

  it("audits the preview leg, which reaches no core function of its own", async () => {
    const r = await writeTool(toolContext(MCP), "remove_user", { user_id: "u-9" }, async () => ({
      preview: "Permanently delete Dana Reed (dana@example.com).",
      confirmation_token: "signed.token",
      expires_in: 600,
    }))
    expect(recordMcpPreview).toHaveBeenCalledWith(toolContext(MCP).actor, "remove_user", {
      user_id: "u-9",
    })
    expect((r.structuredContent as { confirmation_token: string }).confirmation_token).toBe(
      "signed.token",
    )
  })

  it("writes no preview row on the executing leg — the core audits that one", async () => {
    const r = await writeTool(
      toolContext(MCP),
      "remove_user",
      { user_id: "u-9", confirmation_token: "signed.token" },
      async () => ({ audit_id: "a9", target: { type: "user", id: "u-9", deleted: true } }),
    )
    expect(recordMcpPreview).not.toHaveBeenCalled()
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("a9")
  })

  it("never lets a preview-audit failure block the preview", async () => {
    recordMcpPreview.mockRejectedValue(new Error("audit table unavailable"))
    const r = await writeTool(toolContext(MCP), "remove_user", { user_id: "u-9" }, async () => ({
      preview: "Permanently delete Dana Reed (dana@example.com).",
      confirmation_token: "signed.token",
      expires_in: 600,
    }))
    expect(r.isError).toBeUndefined()
    expect((r.structuredContent as { confirmation_token: string }).confirmation_token).toBe(
      "signed.token",
    )
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException.mock.calls[0][1]).toMatchObject({
      tags: { mcp_tool: "remove_user", mcp_stage: "preview_audit" },
    })
  })

  it("blocks the 31st write in a minute for the same token", async () => {
    const ctx = toolContext(MCP)
    for (let i = 0; i < WRITE_LIMIT_PER_MINUTE; i++) {
      const ok = await writeTool(ctx, "approve_listing", {}, async () => ({ audit_id: `a${i}` }))
      expect(ok.isError).toBeUndefined()
    }
    const blocked = await writeTool(ctx, "approve_listing", {}, async () => ({ audit_id: "a31" }))
    expect(blocked.isError).toBe(true)
    expect((blocked.content[0] as { text: string }).text).toMatch(/Too many write operations/)
  })

  it("keys the limit on the token, so another token is unaffected", async () => {
    const a = toolContext(MCP)
    for (let i = 0; i < WRITE_LIMIT_PER_MINUTE; i++) {
      await writeTool(a, "approve_listing", {}, async () => ({ audit_id: `a${i}` }))
    }
    const b = toolContext({ ...MCP, tokenId: "tok-2" })
    const r = await writeTool(b, "approve_listing", {}, async () => ({ audit_id: "b1" }))
    expect(r.isError).toBeUndefined()
  })
})

describe("annotation presets", () => {
  it("never claims an open world", () => {
    expect(READ_ANNOTATIONS.openWorldHint).toBe(false)
    expect(DESTRUCTIVE_ANNOTATIONS.openWorldHint).toBe(false)
  })

  it("marks reads read-only and destructive writes destructive", () => {
    expect(READ_ANNOTATIONS).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(DESTRUCTIVE_ANNOTATIONS).toMatchObject({ readOnlyHint: false, destructiveHint: true })
  })

  it("carries the Claude per-call interaction flag for destructive tools", () => {
    expect(REQUIRES_USER_INTERACTION).toEqual({ "anthropic/requiresUserInteraction": true })
  })
})

describe("deletedTarget", () => {
  it("describes a row that no longer exists", () => {
    expect(deletedTarget("user", "u-9")).toEqual({ type: "user", id: "u-9", deleted: true })
  })
})
