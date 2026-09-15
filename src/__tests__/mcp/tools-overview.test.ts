import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { recordMcpRead, recordMcpPreview, marketplaceOverview, getRecentActivity, listAuditLog } =
  vi.hoisted(() => ({
    recordMcpRead: vi.fn(),
    recordMcpPreview: vi.fn(),
    marketplaceOverview: vi.fn(),
    getRecentActivity: vi.fn(),
    listAuditLog: vi.fn(),
  }))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead, recordMcpPreview }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity }))
// The harness builds the WHOLE server, so the other domains' modules load too.
// They are stubbed only so their `@/db` import never runs; no test here calls them.
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
vi.mock("@/lib/mcp/queries/data-mappings", () => ({ unresolvedMappings: vi.fn() }))
vi.mock("@/lib/admin/core/data-mappings", () => ({ setLocationMapping: vi.fn() }))
vi.mock("@/lib/competitor-query", () => ({ getCompetitorClosures: vi.fn() }))
vi.mock("@/lib/mcp/queries/alerts", () => ({ listAlerts: vi.fn() }))
vi.mock("@/lib/mcp/oauth/grants", () => ({
  listMcpConnections: vi.fn(),
  revokeMcpToken: vi.fn(),
}))

import { mcpTestClient } from "../../../test/helpers/mcp-harness"

beforeEach(() => {
  recordMcpRead.mockReset().mockResolvedValue("audit-1")
  recordMcpPreview.mockReset().mockResolvedValue("audit-preview")
  marketplaceOverview.mockReset().mockResolvedValue({ listings: { total: 0, by_status: {} } })
  listAuditLog.mockReset().mockResolvedValue({ items: [], next_cursor: null })
  getRecentActivity.mockReset().mockResolvedValue({ items: [], nextCursor: null })
})

describe("get_marketplace_overview", () => {
  it("writes an mcp.read audit row naming the tool", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "get_marketplace_overview", arguments: {} })
    expect(recordMcpRead).toHaveBeenCalledWith(
      { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" },
      "get_marketplace_overview",
      {},
    )
  })

  it("surfaces a plain Error from the query as the tool's message", async () => {
    marketplaceOverview.mockRejectedValue(new Error("Analytics unavailable"))
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "get_marketplace_overview", arguments: {} })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Analytics unavailable")
  })
})

describe("list_recent_activity", () => {
  it("passes filters through and renames nextCursor to next_cursor", async () => {
    getRecentActivity.mockResolvedValue({
      items: [
        {
          at: new Date("2026-09-14T12:00:00.000Z"),
          kind: "admin_action",
          id: "a1",
          actor: { id: "u-1", name: "Parker", email: "p@hellosugar.salon" },
          target: { type: "listing", id: "l-1", label: "Aspen" },
          summary: "Approved listing Aspen",
          source: "mcp",
        },
      ],
      nextCursor: "CURSOR",
    })
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_recent_activity",
      arguments: { kinds: ["admin_action"], since: "2026-09-01T00:00:00.000Z", limit: 10 },
    })
    expect(getRecentActivity).toHaveBeenCalledWith({
      kinds: ["admin_action"],
      actorUserId: undefined,
      since: new Date("2026-09-01T00:00:00.000Z"),
      cursor: undefined,
      limit: 10,
    })
    expect(r.structuredContent).toEqual({
      items: [
        {
          at: "2026-09-14T12:00:00.000Z",
          kind: "admin_action",
          id: "a1",
          actor: { id: "u-1", name: "Parker", email: "p@hellosugar.salon" },
          target: { type: "listing", id: "l-1", label: "Aspen" },
          summary: "Approved listing Aspen",
          source: "mcp",
        },
      ],
      next_cursor: "CURSOR",
    })
  })

  it("defaults the limit to 25 when the caller omits it", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "list_recent_activity", arguments: {} })
    expect(getRecentActivity.mock.calls[0][0].limit).toBe(25)
  })

  it("rejects an unknown activity kind at the schema, not in the handler", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_recent_activity", arguments: { kinds: ["nope"] } })
    expect(r.isError).toBe(true)
    expect(getRecentActivity).not.toHaveBeenCalled()
  })

  it("rejects an empty actor_user_id rather than returning the whole feed", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_recent_activity",
      arguments: { actor_user_id: "" },
    })
    expect(r.isError).toBe(true)
    expect(getRecentActivity).not.toHaveBeenCalled()
  })
})

describe("list_audit_log", () => {
  it("maps snake_case tool arguments onto the query's camelCase filters", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({
      name: "list_audit_log",
      arguments: {
        actor_user_id: "u-9",
        action: "listing.approve",
        target_type: "listing",
        target_id: "l-1",
        source: "mcp",
        since: "2026-09-01T00:00:00.000Z",
        include_reads: true,
        limit: 50,
        cursor: "C",
      },
    })
    expect(listAuditLog).toHaveBeenCalledWith({
      actorUserId: "u-9",
      action: "listing.approve",
      targetType: "listing",
      targetId: "l-1",
      source: "mcp",
      since: new Date("2026-09-01T00:00:00.000Z"),
      includeReads: true,
      limit: 50,
      cursor: "C",
    })
  })

  it("returns the query's page shape unchanged", async () => {
    listAuditLog.mockResolvedValue({ items: [{ id: "a1" }], next_cursor: "NEXT" })
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_audit_log", arguments: {} })
    expect(r.structuredContent).toEqual({ items: [{ id: "a1" }], next_cursor: "NEXT" })
  })

  // Each of these is dropped by listAuditLog's truthiness guard, so an empty string
  // would have returned the WHOLE audit log dressed as a filtered page.
  it.each(["actor_user_id", "action", "target_id"])(
    "rejects an empty %s rather than returning the whole log",
    async (field) => {
      const { client } = await mcpTestClient()
      const r = await client.callTool({ name: "list_audit_log", arguments: { [field]: "" } })
      expect(r.isError).toBe(true)
      expect(listAuditLog).not.toHaveBeenCalled()
    },
  )
})
