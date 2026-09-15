import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  getUsers: vi.fn(),
  adminCount: vi.fn(),
  setUserRole: vi.fn(),
  setSellerAccess: vi.fn(),
  removeUser: vi.fn(),
  getAllowlist: vi.fn(),
  addToAllowlist: vi.fn(),
  removeFromAllowlist: vi.fn(),
  getUserAnalytics: vi.fn(),
  getAnalyticsSummary: vi.fn(),
  getLoginTrend: vi.fn(),
  userDetail: vi.fn(),
  getAllListings: vi.fn(),
  queryAdminListing: vi.fn(),
  listingExtras: vi.fn(),
  marketplaceOverview: vi.fn(),
  getRecentActivity: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/admin/core/users", () => ({
  getUsers: core.getUsers,
  adminCount: core.adminCount,
  setUserRole: core.setUserRole,
  setSellerAccess: core.setSellerAccess,
  removeUser: core.removeUser,
}))
vi.mock("@/lib/admin/core/allowlist", () => ({
  getAllowlist: core.getAllowlist,
  addToAllowlist: core.addToAllowlist,
  removeFromAllowlist: core.removeFromAllowlist,
}))
vi.mock("@/lib/admin/core/analytics", () => ({
  getUserAnalytics: core.getUserAnalytics,
  getAnalyticsSummary: core.getAnalyticsSummary,
  getLoginTrend: core.getLoginTrend,
}))
vi.mock("@/lib/mcp/queries/users", () => ({ userDetail: core.userDetail }))
vi.mock("@/lib/admin/core/listings", () => ({
  getAllListings: core.getAllListings,
  approveListing: vi.fn(),
  rejectListing: vi.fn(),
  adminUpdateListing: vi.fn(),
  adminMarkSold: vi.fn(),
}))
vi.mock("@/lib/listings/load-listing", () => ({ queryAdminListing: core.queryAdminListing }))
vi.mock("@/lib/mcp/queries/listings", () => ({ listingExtras: core.listingExtras }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview: core.marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog: core.listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity: core.getRecentActivity }))
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

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import { __resetRateLimits } from "@/lib/rate-limit"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: "u-2",
    name: "Dana",
    email: "dana@example.com",
    role: "user",
    sellerAccess: false,
    loginCount: 4,
    lastLoginAt: new Date("2026-09-10T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...over,
  }
}

beforeEach(() => {
  // The confirmation HMAC reads env.MCP_CONFIRM_SECRET lazily, and `env` is a live
  // process.env proxy under SKIP_ENV_VALIDATION — stubbing the raw variable is enough.
  vi.stubEnv("MCP_CONFIRM_SECRET", "test-secret-at-least-32-characters-long")
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.getUsers.mockResolvedValue([
    userRow(),
    // The admin's name and email share no substring, so a search can isolate either half.
    userRow({ id: "u-1", role: "admin", name: "Parker", email: "admin@hellosugar.salon" }),
  ])
  // Two admins by default, so the last-admin pre-checks stay out of the way of
  // every test that is not about them.
  core.adminCount.mockResolvedValue(2)
  core.getAllowlist.mockResolvedValue([
    { id: "al-1", email: "@partnerbrand.com", addedBy: "u-1", addedAt: new Date("2026-05-01T00:00:00.000Z") },
  ])
  core.getUserAnalytics.mockResolvedValue([
    {
      id: "u-2",
      name: "Dana",
      email: "dana@example.com",
      role: "user",
      loginCount: 4,
      lastLoginAt: new Date("2026-09-10T00:00:00.000Z"),
      listingsPosted: 1,
      reachOutsSent: 2,
      inquiriesReceived: 0,
      savesMade: 3,
      spark: [0, 1],
    },
  ])
  core.userDetail.mockResolvedValue({
    owner_links: [],
    listings: [],
    alerts: [],
    favorites: [],
  })
  core.setUserRole.mockResolvedValue({ auditId: "aud-role" })
  core.setSellerAccess.mockResolvedValue({ auditId: "aud-seller" })
  core.removeUser.mockResolvedValue({ auditId: "aud-remove" })
  core.addToAllowlist.mockResolvedValue({ ok: true, auditId: "aud-allow" })
  core.removeFromAllowlist.mockResolvedValue({ auditId: "aud-unallow" })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("list_users", () => {
  it("projects the roster and never leaks a password-ish field", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_users", arguments: {} })
    const items = (r.structuredContent as { items: Record<string, unknown>[] }).items
    expect(items[0]).toEqual({
      id: "u-2",
      name: "Dana",
      email: "dana@example.com",
      role: "user",
      seller_access: false,
      login_count: 4,
      last_login_at: "2026-09-10T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    })
  })

  it("filters by role and by search across name and email", async () => {
    const { client } = await mcpTestClient()
    const byRole = await client.callTool({ name: "list_users", arguments: { role: "admin" } })
    expect((byRole.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["u-1"])
    const byEmail = await client.callTool({ name: "list_users", arguments: { search: "dana@" } })
    expect((byEmail.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["u-2"])
    // "parker" appears in the admin row's NAME only, so this proves the other half
    // of "across name and email".
    const byName = await client.callTool({ name: "list_users", arguments: { search: "parker" } })
    expect((byName.structuredContent as { items: { id: string }[] }).items.map((i) => i.id)).toEqual(["u-1"])
  })
})

describe("get_user", () => {
  it("merges the analytics row with the relationship detail", async () => {
    core.userDetail.mockResolvedValue({
      owner_links: [{ owner_identifier: "Austin LLC", source: "manual", updated_at: "2026-07-01T00:00:00.000Z" }],
      listings: [{ id: "l-1", title: "Aspen", status: "active" }],
      alerts: [{ id: "a-1", name: "CO suites", notify_enabled: true, created_at: "2026-06-01T00:00:00.000Z" }],
      favorites: [{ listing_id: "l-9", created_at: "2026-06-02T00:00:00.000Z" }],
    })
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "get_user", arguments: { user_id: "u-2" } })
    const body = r.structuredContent as {
      user: Record<string, unknown>
      activity: Record<string, unknown>
      owner_links: { owner_identifier: string }[]
      listings: { id: string }[]
      alerts: { id: string }[]
      favorites: { listing_id: string }[]
    }
    expect(body.user).toMatchObject({ id: "u-2", role: "user", seller_access: false })
    expect(body.activity).toMatchObject({ listings_posted: 1, reach_outs_sent: 2, saves_made: 3 })
    expect(body.owner_links[0].owner_identifier).toBe("Austin LLC")
    expect(body.listings[0].id).toBe("l-1")
    expect(body.alerts[0].id).toBe("a-1")
    expect(body.favorites[0].listing_id).toBe("l-9")
  })

  it("refuses an unknown user id with a clear message", async () => {
    core.getUsers.mockResolvedValue([])
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "get_user", arguments: { user_id: "ghost" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("User not found")
  })
})

describe("list_allowlist", () => {
  it("labels a domain entry so the model can tell it from an address", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_allowlist", arguments: {} })
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      id: "al-1",
      email: "@partnerbrand.com",
      kind: "domain",
      added_by: "u-1",
      added_at: "2026-05-01T00:00:00.000Z",
    })
  })
})

describe("set_seller_access (non-destructive)", () => {
  it("executes immediately and returns the post-write user", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_seller_access",
      arguments: { user_id: "u-2", seller_access: true },
    })
    expect(core.setSellerAccess).toHaveBeenCalledWith(ACTOR, "u-2", true)
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-seller")
  })
})

describe("add_to_allowlist (non-destructive, ok/error contract)", () => {
  it("turns { ok: false } into an isError result", async () => {
    core.addToAllowlist.mockResolvedValue({ ok: false, error: "Domain already in allowlist" })
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "add_to_allowlist", arguments: { entry: "@brand.com" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Domain already in allowlist")
  })

  it("reports the stored row, normalized, rather than echoing the caller's casing", async () => {
    core.getAllowlist.mockResolvedValue([
      { id: "al-2", email: "jane@brand.com", addedBy: "u-1", addedAt: new Date("2026-09-15T00:00:00.000Z") },
    ])
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "add_to_allowlist",
      arguments: { entry: "Jane@Brand.COM" },
    })
    // The raw entry goes to the core, which owns the normalization.
    expect(core.addToAllowlist).toHaveBeenCalledWith(ACTOR, "Jane@Brand.COM")
    expect(r.structuredContent).toEqual({
      audit_id: "aud-allow",
      target: {
        id: "al-2",
        email: "jane@brand.com",
        kind: "address",
        added_by: "u-1",
        added_at: "2026-09-15T00:00:00.000Z",
      },
    })
  })

  it("refuses to fabricate a target when the stored entry cannot be read back", async () => {
    core.getAllowlist.mockResolvedValue([])
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "add_to_allowlist", arguments: { entry: "jane@brand.com" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toContain("could not read the stored entry back")
  })
})

describe("set_user_role (destructive)", () => {
  it("previews before demoting", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_user_role",
      arguments: { user_id: "u-2", role: "admin" },
    })
    expect((r.structuredContent as { preview: string }).preview).toContain("Dana")
    expect((r.structuredContent as { preview: string }).preview).toContain("admin")
    expect(core.setUserRole).not.toHaveBeenCalled()
  })

  it("executes with a matching token", async () => {
    const { client } = await mcpTestClient()
    const args = { user_id: "u-2", role: "admin" as const }
    const preview = await client.callTool({ name: "set_user_role", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    await client.callTool({ name: "set_user_role", arguments: { ...args, confirmation_token: token } })
    expect(core.setUserRole).toHaveBeenCalledWith(ACTOR, "u-2", "admin")
  })

  it("refuses demoting the last admin at the pre-check, before any token is minted", async () => {
    core.adminCount.mockResolvedValue(1)
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_user_role",
      arguments: { user_id: "u-1", role: "user" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Cannot demote the last admin")
    expect(r.structuredContent).not.toHaveProperty("confirmation_token")
    expect(core.setUserRole).not.toHaveBeenCalled()
  })

  it("still demotes an admin when another admin remains", async () => {
    const { client } = await mcpTestClient()
    const args = { user_id: "u-1", role: "user" as const }
    const preview = await client.callTool({ name: "set_user_role", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    await client.callTool({
      name: "set_user_role",
      arguments: { ...args, confirmation_token: token },
    })
    expect(core.setUserRole).toHaveBeenCalledWith(ACTOR, "u-1", "user")
  })
})

describe("remove_user (destructive)", () => {
  it("refuses self-removal at the pre-check, before any token is minted", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "remove_user", arguments: { user_id: "u-1" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Cannot remove yourself")
    expect(r.structuredContent).not.toHaveProperty("confirmation_token")
  })

  it("refuses removing the last admin at the pre-check, before any token is minted", async () => {
    core.adminCount.mockResolvedValue(1)
    core.getUsers.mockResolvedValue([
      userRow({ id: "u-3", role: "admin", name: "Sam", email: "sam@hellosugar.salon" }),
    ])
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "remove_user", arguments: { user_id: "u-3" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Cannot remove the last admin")
    expect(r.structuredContent).not.toHaveProperty("confirmation_token")
    expect(core.removeUser).not.toHaveBeenCalled()
  })

  it("warns in the preview that the user's listings cascade away", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "remove_user", arguments: { user_id: "u-2" } })
    const preview = (r.structuredContent as { preview: string }).preview
    expect(preview).toContain("dana@example.com")
    expect(preview).toMatch(/listings|cascade|permanently/i)
  })

  it("returns a deleted target after executing", async () => {
    const { client } = await mcpTestClient()
    const preview = await client.callTool({ name: "remove_user", arguments: { user_id: "u-2" } })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "remove_user",
      arguments: { user_id: "u-2", confirmation_token: token },
    })
    expect(core.removeUser).toHaveBeenCalledWith(ACTOR, "u-2")
    expect(r.structuredContent).toEqual({
      audit_id: "aud-remove",
      target: { type: "user", id: "u-2", deleted: true },
    })
  })
})

describe("remove_from_allowlist (destructive)", () => {
  it("previews, then executes and reports a deleted target", async () => {
    const { client } = await mcpTestClient()
    // Mixed case on the way in: the core deletes the lowercased value, so the preview
    // and the deleted target must both name that, not what the caller typed.
    const preview = await client.callTool({
      name: "remove_from_allowlist",
      arguments: { email: "@PartnerBrand.com" },
    })
    expect((preview.structuredContent as { preview: string }).preview).toContain(
      '"@partnerbrand.com"',
    )
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "remove_from_allowlist",
      arguments: { email: "@PartnerBrand.com", confirmation_token: token },
    })
    expect(core.removeFromAllowlist).toHaveBeenCalledWith(ACTOR, "@PartnerBrand.com")
    expect(r.structuredContent).toEqual({
      audit_id: "aud-unallow",
      target: { type: "allowlist", id: "@partnerbrand.com", deleted: true },
    })
  })
})

describe("scope gating", () => {
  it("hides every user write tool from a read-only token", async () => {
    const { client } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(["list_users", "get_user", "list_allowlist"]))
    for (const w of [
      "set_user_role",
      "set_seller_access",
      "add_to_allowlist",
      "remove_from_allowlist",
      "remove_user",
    ]) {
      expect(names).not.toContain(w)
    }
  })
})
