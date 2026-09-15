import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Module mocks for every module the assembled server reaches.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  listMcpConnections: vi.fn(),
  revokeMcpToken: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/mcp/oauth/grants", () => ({
  listMcpConnections: core.listMcpConnections,
  revokeMcpToken: core.revokeMcpToken,
}))
// The harness builds the WHOLE server, so the other domains' modules load too.
// They are stubbed only so their `@/db` import never runs; no test here calls them.
vi.mock("@/lib/competitor-query", () => ({ getCompetitorClosures: vi.fn() }))
vi.mock("@/lib/mcp/queries/alerts", () => ({ listAlerts: vi.fn() }))
vi.mock("@/lib/mcp/queries/data-mappings", () => ({ unresolvedMappings: vi.fn() }))
vi.mock("@/lib/admin/core/data-mappings", () => ({ setLocationMapping: vi.fn() }))
vi.mock("@/lib/owner-directory/data", () => ({
  queryOwnerDirectory: vi.fn(),
  queryUsersWithLinks: vi.fn(),
}))
vi.mock("@/lib/admin/core/owner-links", () => ({
  addOwnerLink: vi.fn(),
  revokeOwnerLink: vi.fn(),
  clearOwnerLink: vi.fn(),
}))
vi.mock("@/lib/admin/core/owner-directory", () => ({ refreshOwnerDirectory: vi.fn() }))
vi.mock("@/lib/admin/core/listings", () => ({
  getAllListings: vi.fn(),
  approveListing: vi.fn(),
  rejectListing: vi.fn(),
  adminUpdateListing: vi.fn(),
  adminMarkSold: vi.fn(),
}))
vi.mock("@/lib/listings/load-listing", () => ({ queryAdminListing: vi.fn() }))
vi.mock("@/lib/mcp/queries/listings", () => ({ listingExtras: vi.fn() }))
vi.mock("@/lib/admin/core/users", () => ({
  getUsers: vi.fn(),
  adminCount: vi.fn(),
  setUserRole: vi.fn(),
  setSellerAccess: vi.fn(),
  removeUser: vi.fn(),
}))
vi.mock("@/lib/admin/core/allowlist", () => ({
  getAllowlist: vi.fn(),
  addToAllowlist: vi.fn(),
  removeFromAllowlist: vi.fn(),
}))
vi.mock("@/lib/admin/core/analytics", () => ({
  getUserAnalytics: vi.fn(),
  getAnalyticsSummary: vi.fn(),
  getLoginTrend: vi.fn(),
}))
vi.mock("@/lib/mcp/queries/users", () => ({ userDetail: vi.fn() }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview: vi.fn() }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog: vi.fn() }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity: vi.fn() }))
vi.mock("@/lib/mcp/queries/brand-requests", () => ({
  listBrandRequests: vi.fn(),
  getBrandRequestDetail: vi.fn(),
}))
vi.mock("@/lib/admin/core/brand-requests", () => ({
  // Real values: the reject tool reads this constant at load time.
  APPROVED_STATUSES: ["approved", "building", "live"],
  approveBrandRequest: vi.fn(),
  rejectBrandRequest: vi.fn(),
  retryMonitorDispatch: vi.fn(),
}))
vi.mock("@/lib/admin/core/inquiries", () => ({ getInquiries: vi.fn() }))
// --------------------------- end of mock block -----------------------------

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import { __resetRateLimits } from "@/lib/rate-limit"
import type { McpConnectionRow } from "@/lib/mcp/oauth/grants"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

const HOUR = 3_600_000

/** A live grant belonging to the test actor. Overrides shape the status cases. */
function connection(over: Partial<McpConnectionRow> = {}): McpConnectionRow {
  return {
    id: "tok-9",
    userId: "u-1",
    userEmail: "admin@hellosugar.salon",
    clientId: "claude-hosted",
    clientName: "Claude",
    scope: "marketplace:read marketplace:write",
    label: "Parker's laptop",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    lastUsedAt: new Date("2026-09-13T00:00:00.000Z"),
    expiresAt: new Date(Date.now() + HOUR),
    refreshExpiresAt: new Date(Date.now() + 30 * 24 * HOUR),
    revokedAt: null,
    ...over,
  }
}

type ConnectionBody = {
  items: {
    token_id: string
    status: string
    is_current_connection: boolean
  }[]
  next_cursor: string | null
}

beforeEach(() => {
  // The confirmation HMAC reads env.MCP_CONFIRM_SECRET lazily, and `env` is a live
  // process.env proxy under SKIP_ENV_VALIDATION — stubbing the raw variable is enough.
  vi.stubEnv("MCP_CONFIRM_SECRET", "test-secret-at-least-32-characters-long")
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.listMcpConnections.mockResolvedValue([connection()])
  core.revokeMcpToken.mockResolvedValue({ ok: true, auditId: "aud-revoke-mcp" })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("list_mcp_connections", () => {
  it("lists the caller's own grants by default", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_mcp_connections", arguments: {} })
    // `all` is required on the query, so the tool must resolve the default itself.
    expect(core.listMcpConnections).toHaveBeenCalledWith({ userId: "u-1", all: false })
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      token_id: "tok-9",
      client_id: "claude-hosted",
      client_name: "Claude",
      label: "Parker's laptop",
      scopes: ["marketplace:read", "marketplace:write"],
      status: "active",
      user: { id: "u-1", email: "admin@hellosugar.salon" },
      created_at: "2026-09-01T00:00:00.000Z",
      last_used_at: "2026-09-13T00:00:00.000Z",
      expires_at: expect.any(String),
      refresh_expires_at: expect.any(String),
      revoked_at: null,
      is_current_connection: false,
    })
  })

  it("marks the grant this request is authenticated with", async () => {
    core.listMcpConnections.mockResolvedValue([connection({ id: "tok-1" })])
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_mcp_connections", arguments: {} })
    expect((r.structuredContent as ConnectionBody).items[0].is_current_connection).toBe(true)
  })

  it("reports revoked, expired and idle grants distinctly", async () => {
    core.listMcpConnections.mockResolvedValue([
      connection({ id: "a", revokedAt: new Date("2026-09-02T00:00:00.000Z") }),
      // Refresh token gone too: the grant is dead, not merely stale.
      connection({
        id: "b",
        expiresAt: new Date(Date.now() - HOUR),
        refreshExpiresAt: new Date(Date.now() - HOUR),
      }),
      // Access token lapsed, refresh still good: the client just renews.
      connection({ id: "c", expiresAt: new Date(Date.now() - HOUR) }),
    ])
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_mcp_connections", arguments: {} })
    const items = (r.structuredContent as ConnectionBody).items
    expect(items.map((i) => i.status)).toEqual(["revoked", "expired", "idle"])
  })

  it("forwards all: true", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "list_mcp_connections", arguments: { all: true } })
    expect(core.listMcpConnections).toHaveBeenCalledWith({ userId: "u-1", all: true })
  })

  it("pages like every other list tool", async () => {
    core.listMcpConnections.mockResolvedValue([connection(), connection({ id: "tok-8" })])
    const { client } = await mcpTestClient()
    const first = await client.callTool({ name: "list_mcp_connections", arguments: { limit: 1 } })
    const page1 = first.structuredContent as ConnectionBody
    expect(page1.items.map((i) => i.token_id)).toEqual(["tok-9"])
    expect(page1.next_cursor).toBeTruthy()

    const second = await client.callTool({
      name: "list_mcp_connections",
      arguments: { limit: 1, cursor: page1.next_cursor as string },
    })
    const page2 = second.structuredContent as ConnectionBody
    expect(page2.items.map((i) => i.token_id)).toEqual(["tok-8"])
    expect(page2.next_cursor).toBeNull()
  })
})

describe("revoke_mcp_connection (destructive)", () => {
  it("previews, then revokes own-grants-only through the audited core", async () => {
    const { client } = await mcpTestClient()
    const preview = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-9" },
    })
    const body = preview.structuredContent as { preview: string; confirmation_token: string }
    expect(body.preview).toContain("Parker's laptop")
    expect(body.preview).toContain("Claude")
    expect(core.revokeMcpToken).not.toHaveBeenCalled()

    const done = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-9", confirmation_token: body.confirmation_token },
    })
    // Actor-first, ownOnly — and no second audit wrapper: revokeMcpToken already
    // writes the `mcp_token.revoke` row and hands back its id.
    expect(core.revokeMcpToken).toHaveBeenCalledWith(ACTOR, { tokenId: "tok-9", ownOnly: true })
    expect(done.structuredContent).toEqual({
      audit_id: "aud-revoke-mcp",
      target: { type: "mcp_token", id: "tok-9", revoked: true },
    })
  })

  it("warns extra loudly when revoking the connection being used right now", async () => {
    core.listMcpConnections.mockResolvedValue([connection({ id: "tok-1" })])
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-1" },
    })
    expect((r.structuredContent as { preview: string }).preview).toMatch(
      /connection you are using right now/i,
    )
  })

  it("refuses a token_id that is not one of the caller's grants", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "someone-elses" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Connection not found")
    expect(core.revokeMcpToken).not.toHaveBeenCalled()
  })

  it("looks the grant up among the caller's own connections only", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "revoke_mcp_connection", arguments: { token_id: "tok-9" } })
    expect(core.listMcpConnections).toHaveBeenCalledWith({ userId: "u-1", all: false })
  })

  it("surfaces a refusal from revokeMcpToken", async () => {
    core.revokeMcpToken.mockResolvedValue({
      ok: false,
      error: "You can only revoke your own MCP connections",
      auditId: "aud-refused",
    })
    const { client } = await mcpTestClient()
    const preview = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-9" },
    })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "revoke_mcp_connection",
      arguments: { token_id: "tok-9", confirmation_token: token },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe(
      "You can only revoke your own MCP connections",
    )
  })
})

describe("scope gating", () => {
  it("hides the revoke from a read-only token but keeps the list", async () => {
    const { client } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain("list_mcp_connections")
    expect(names).not.toContain("revoke_mcp_connection")
  })
})
