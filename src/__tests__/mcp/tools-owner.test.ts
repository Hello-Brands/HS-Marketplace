import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  queryOwnerDirectory: vi.fn(),
  queryUsersWithLinks: vi.fn(),
  addOwnerLink: vi.fn(),
  revokeOwnerLink: vi.fn(),
  clearOwnerLink: vi.fn(),
  refreshOwnerDirectory: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/owner-directory/data", () => ({
  queryOwnerDirectory: core.queryOwnerDirectory,
  queryUsersWithLinks: core.queryUsersWithLinks,
}))
vi.mock("@/lib/admin/core/owner-links", () => ({
  addOwnerLink: core.addOwnerLink,
  revokeOwnerLink: core.revokeOwnerLink,
  clearOwnerLink: core.clearOwnerLink,
}))
vi.mock("@/lib/admin/core/owner-directory", () => ({
  refreshOwnerDirectory: core.refreshOwnerDirectory,
}))
// The harness builds the WHOLE server, so the other domains' modules load too.
// They are stubbed only so their `@/db` import never runs; no test here calls them.
vi.mock("@/lib/mcp/queries/data-mappings", () => ({ unresolvedMappings: vi.fn() }))
vi.mock("@/lib/admin/core/data-mappings", () => ({ setLocationMapping: vi.fn() }))
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

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import { __resetRateLimits } from "@/lib/rate-limit"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

beforeEach(() => {
  // The confirmation HMAC reads env.MCP_CONFIRM_SECRET lazily, and `env` is a live
  // process.env proxy under SKIP_ENV_VALIDATION — stubbing the raw variable is enough.
  vi.stubEnv("MCP_CONFIRM_SECRET", "test-secret-at-least-32-characters-long")
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.queryOwnerDirectory.mockResolvedValue([
    {
      id: "ol-1",
      ownerIdentifier: "Austin LLC",
      ownerName: "Austin Holdings",
      ownerContactEmail: "austin@example.com",
      blvdLocationName: "Hello Sugar Austin South",
      blvdLocationNumber: "284",
      locationAddress: "1 Main St, Austin TX",
      resolvedBqLocationName: "Austin South",
      blvdMatchMethod: "exact",
      blvdMatchConfidence: "high",
      syncedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  ])
  core.queryUsersWithLinks.mockResolvedValue([
    {
      id: "u-2",
      name: "Dana",
      email: "dana@example.com",
      links: [{ ownerIdentifier: "Austin LLC", source: "manual" }],
    },
  ])
  core.addOwnerLink.mockResolvedValue({ ok: true, auditId: "aud-add" })
  core.revokeOwnerLink.mockResolvedValue({ ok: true, auditId: "aud-revoke" })
  core.clearOwnerLink.mockResolvedValue({ ok: true, auditId: "aud-clear" })
  core.refreshOwnerDirectory.mockResolvedValue({
    ok: true,
    result: { inserted: 3, updated: 2, deleted: 0 },
    auditId: "aud-refresh",
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("list_owner_directory", () => {
  it("passes the search term through and projects the row", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_owner_directory",
      arguments: { search: "austin" },
    })
    expect(core.queryOwnerDirectory).toHaveBeenCalledWith("austin")
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      id: "ol-1",
      owner_identifier: "Austin LLC",
      owner_name: "Austin Holdings",
      owner_contact_email: "austin@example.com",
      location_name: "Hello Sugar Austin South",
      location_number: "284",
      location_address: "1 Main St, Austin TX",
      resolved_bq_location_name: "Austin South",
      match_method: "exact",
      match_confidence: "high",
      synced_at: "2026-09-01T00:00:00.000Z",
    })
  })
})

describe("list_owner_links", () => {
  it("returns each user with every link, revoked ones included", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_owner_links", arguments: {} })
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      id: "u-2",
      name: "Dana",
      email: "dana@example.com",
      links: [{ owner_identifier: "Austin LLC", source: "manual" }],
    })
  })

  it("filters to one user id", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_owner_links",
      arguments: { user_id: "nobody" },
    })
    expect((r.structuredContent as { items: unknown[] }).items).toEqual([])
  })
})

describe("add_owner_link (non-destructive)", () => {
  it("executes immediately", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "add_owner_link",
      arguments: { user_id: "u-2", owner_identifier: "Austin LLC" },
    })
    expect(core.addOwnerLink).toHaveBeenCalledWith(ACTOR, "u-2", "Austin LLC")
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-add")
  })

  it("turns the core's { ok: false } into a tool error", async () => {
    core.addOwnerLink.mockResolvedValue({ ok: false, error: "Unknown owner_identifier: Nope" })
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "add_owner_link",
      arguments: { user_id: "u-2", owner_identifier: "Nope" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Unknown owner_identifier: Nope")
  })
})

describe("revoke_owner_link / clear_owner_link (destructive)", () => {
  it("revoke previews, then executes", async () => {
    const { client } = await mcpTestClient()
    const args = { user_id: "u-2", owner_identifier: "Austin LLC" }
    const preview = await client.callTool({ name: "revoke_owner_link", arguments: args })
    const body = preview.structuredContent as { preview: string; confirmation_token: string }
    expect(body.preview).toContain("Austin LLC")
    expect(core.revokeOwnerLink).not.toHaveBeenCalled()
    await client.callTool({
      name: "revoke_owner_link",
      arguments: { ...args, confirmation_token: body.confirmation_token },
    })
    expect(core.revokeOwnerLink).toHaveBeenCalledWith(ACTOR, "u-2", "Austin LLC")
  })

  it("clear explains that automatic re-linking becomes possible again", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "clear_owner_link",
      arguments: { user_id: "u-2", owner_identifier: "Austin LLC" },
    })
    expect((r.structuredContent as { preview: string }).preview).toMatch(/re-?link|next login/i)
  })

  it("a revoke token cannot execute a clear", async () => {
    const { client } = await mcpTestClient()
    const args = { user_id: "u-2", owner_identifier: "Austin LLC" }
    const preview = await client.callTool({ name: "revoke_owner_link", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "clear_owner_link",
      arguments: { ...args, confirmation_token: token },
    })
    expect(r.isError).toBe(true)
    expect(core.clearOwnerLink).not.toHaveBeenCalled()
  })
})

describe("refresh_owner_directory (non-destructive)", () => {
  it("returns the sync result and the audit id", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "refresh_owner_directory", arguments: {} })
    expect(core.refreshOwnerDirectory).toHaveBeenCalledWith(ACTOR)
    expect(r.structuredContent).toEqual({
      audit_id: "aud-refresh",
      target: { type: "owner_directory", id: null, result: { inserted: 3, updated: 2, deleted: 0 } },
    })
  })

  it("turns a failed sync into a tool error", async () => {
    core.refreshOwnerDirectory.mockResolvedValue({ ok: false, error: "sync failed" })
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "refresh_owner_directory", arguments: {} })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("sync failed")
  })
})

describe("scope gating", () => {
  it("hides the owner writes from a read-only token", async () => {
    const { client } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(["list_owner_directory", "list_owner_links"]),
    )
    for (const w of [
      "add_owner_link",
      "revoke_owner_link",
      "clear_owner_link",
      "refresh_owner_directory",
    ]) {
      expect(names).not.toContain(w)
    }
  })
})
