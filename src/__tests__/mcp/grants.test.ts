import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

const { select, update, findFirst, withAudit } = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
  withAudit: vi.fn(
    async (
      _actor: unknown,
      _action: string,
      _target: unknown,
      _args: unknown,
      fn: () => Promise<unknown>,
    ) => ({ result: await fn(), auditId: "audit-1" }),
  ),
}))

vi.mock("@/lib/admin/audit", () => ({ withAudit }))

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => select(...args),
    update: (...args: unknown[]) => update(...args),
    query: { mcpOauthTokens: { findFirst } },
  },
}))

import { listMcpConnections, revokeMcpToken } from "@/lib/mcp/oauth/grants"
import { uiActor } from "@/lib/admin/core/actor"

const actor = uiActor("admin-1")

const CONNECTION = {
  id: "tok-1",
  userId: "admin-1",
  userEmail: "parker@hellosugar.salon",
  clientId: "claude-hosted",
  clientName: "Claude (claude.ai)",
  scope: "marketplace:read marketplace:write",
  label: "Parker's laptop",
  createdAt: new Date("2026-09-14T10:00:00.000Z"),
  lastUsedAt: new Date("2026-09-14T11:00:00.000Z"),
  expiresAt: new Date("2026-09-14T12:00:00.000Z"),
  refreshExpiresAt: new Date("2026-10-14T10:00:00.000Z"),
  revokedAt: null,
}

let selectBuilder: ChainedBuilder
let updateBuilder: ChainedBuilder

beforeEach(() => {
  vi.clearAllMocks()
  selectBuilder = builder([CONNECTION])
  updateBuilder = builder(undefined)
  select.mockReturnValue(selectBuilder)
  update.mockReturnValue(updateBuilder)
  findFirst.mockResolvedValue({ id: "tok-1", userId: "admin-1", revokedAt: null })
})

describe("listMcpConnections", () => {
  it("returns the joined row shape the admin table renders", async () => {
    const rows = await listMcpConnections({ userId: "admin-1", all: false })
    expect(rows).toEqual([CONNECTION])
  })

  it("filters to the caller when all is false", async () => {
    await listMcpConnections({ userId: "admin-1", all: false })
    expect(selectBuilder.calls.where).toHaveLength(1)
  })

  it("applies no owner filter when all is true", async () => {
    await listMcpConnections({ userId: "admin-1", all: true })
    expect(selectBuilder.calls.where ?? []).toHaveLength(0)
  })

  it("orders newest first so the connection just made is on top", async () => {
    await listMcpConnections({ userId: "admin-1", all: false })
    expect(selectBuilder.calls.orderBy).toHaveLength(1)
  })

  it("joins the client so the table can show a display name", async () => {
    await listMcpConnections({ userId: "admin-1", all: true })
    expect(selectBuilder.calls.innerJoin).toHaveLength(2)
  })

  it("returns an empty array when the admin has no connections", async () => {
    select.mockReturnValue(builder([]))
    expect(await listMcpConnections({ userId: "admin-2", all: false })).toEqual([])
  })
})

describe("revokeMcpToken", () => {
  it("stamps revoked_at and reports success", async () => {
    const result = await revokeMcpToken(actor, { tokenId: "tok-1", ownOnly: false })
    expect(result).toEqual({ ok: true, auditId: "audit-1" })
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({ revokedAt: expect.any(Date) })
  })

  it("reports a missing connection instead of throwing", async () => {
    findFirst.mockResolvedValue(undefined)
    expect(await revokeMcpToken(actor, { tokenId: "ghost", ownOnly: false })).toEqual({
      ok: false,
      error: "Connection not found",
      auditId: "audit-1",
    })
    expect(update).not.toHaveBeenCalled()
  })

  it("refuses another admin's connection when ownOnly is set", async () => {
    // This is the MCP tool's path (spec section 7.4): a token must not be able
    // to cut off a different admin.
    findFirst.mockResolvedValue({ id: "tok-9", userId: "admin-2", revokedAt: null })
    expect(await revokeMcpToken(actor, { tokenId: "tok-9", ownOnly: true })).toEqual({
      ok: false,
      error: "You can only revoke your own MCP connections",
      auditId: "audit-1",
    })
    expect(update).not.toHaveBeenCalled()
  })

  it("allows another admin's connection from the admin UI (ownOnly false)", async () => {
    findFirst.mockResolvedValue({ id: "tok-9", userId: "admin-2", revokedAt: null })
    expect(await revokeMcpToken(actor, { tokenId: "tok-9", ownOnly: false })).toEqual({
      ok: true,
      auditId: "audit-1",
    })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("allows the caller's own connection when ownOnly is set", async () => {
    expect(await revokeMcpToken(actor, { tokenId: "tok-1", ownOnly: true })).toEqual({
      ok: true,
      auditId: "audit-1",
    })
  })

  it("is idempotent: revoking an already-revoked connection succeeds without a second write", async () => {
    findFirst.mockResolvedValue({
      id: "tok-1",
      userId: "admin-1",
      revokedAt: new Date("2026-09-13T00:00:00.000Z"),
    })
    expect(await revokeMcpToken(actor, { tokenId: "tok-1", ownOnly: false })).toEqual({
      ok: true,
      auditId: "audit-1",
    })
    // Never move an existing revocation timestamp forward.
    expect(update).not.toHaveBeenCalled()
  })

  it("wraps the mutation in withAudit with the mcp_token.revoke action and target", async () => {
    await revokeMcpToken(actor, { tokenId: "tok-1", ownOnly: false })
    expect(withAudit).toHaveBeenCalledWith(
      actor,
      "mcp_token.revoke",
      { type: "mcp_token", id: "tok-1" },
      { tokenId: "tok-1", ownOnly: false },
      expect.any(Function),
    )
  })
})
