import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  listBrandRequests: vi.fn(),
  getBrandRequestDetail: vi.fn(),
  approveBrandRequest: vi.fn(),
  rejectBrandRequest: vi.fn(),
  retryMonitorDispatch: vi.fn(),
  getInquiries: vi.fn(),
  // Everything else buildMcpServer touches, stubbed so no real DB module loads.
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
vi.mock("@/lib/mcp/queries/brand-requests", () => ({
  listBrandRequests: core.listBrandRequests,
  getBrandRequestDetail: core.getBrandRequestDetail,
}))
vi.mock("@/lib/admin/core/brand-requests", () => ({
  // Real values: the reject tool reads this constant at load time.
  APPROVED_STATUSES: ["approved", "building", "live"],
  approveBrandRequest: core.approveBrandRequest,
  rejectBrandRequest: core.rejectBrandRequest,
  retryMonitorDispatch: core.retryMonitorDispatch,
}))
vi.mock("@/lib/admin/core/inquiries", () => ({ getInquiries: core.getInquiries }))
// The harness builds the WHOLE server, so the other domains' modules load too.
// They are stubbed only so their `@/db` import never runs; no test here calls them.
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

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import { __resetRateLimits } from "@/lib/rate-limit"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

const REQUEST = {
  id: "br-1",
  brand_name: "Waxing Co",
  website_url: "https://waxing.co",
  normalized_domain: "waxing.co",
  status: "recon_complete",
  note: null,
  known_city_state: "Denver, CO",
  submitted_by: { id: "u-2", name: "Dana", email: "dana@example.com" },
  decided_by: null,
  decided_at: null,
  reject_reason: null,
  brand_id: null,
  pr_url: null,
  issue_url: null,
  locations_found: 41,
  error: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z",
}

beforeEach(() => {
  // The confirmation HMAC reads env.MCP_CONFIRM_SECRET lazily, and `env` is a live
  // process.env proxy under SKIP_ENV_VALIDATION — stubbing the raw variable is enough.
  vi.stubEnv("MCP_CONFIRM_SECRET", "test-secret-at-least-32-characters-long")
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.listBrandRequests.mockResolvedValue({ items: [REQUEST], next_cursor: null })
  core.getBrandRequestDetail.mockResolvedValue({ ...REQUEST, recon: { estimatedCost: 12 } })
  core.approveBrandRequest.mockResolvedValue({
    success: true,
    dispatched: true,
    auditId: "aud-approve",
  })
  core.rejectBrandRequest.mockResolvedValue({ success: true, auditId: "aud-reject" })
  core.retryMonitorDispatch.mockResolvedValue({ success: true, auditId: "aud-retry" })
  core.getInquiries.mockResolvedValue([
    {
      id: "c-1",
      message: "Interested",
      buyerName: "Sam",
      buyerEmail: "sam@example.com",
      buyerPhone: null,
      createdAt: new Date("2026-09-10T00:00:00.000Z"),
      listingId: "l-1",
      listingTitle: "Aspen",
      listingLocationName: "Aspen Highlands",
      listingCity: "Aspen",
      listingState: "CO",
      sellerName: "Dana",
      sellerEmail: "dana@example.com",
    },
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("list_brand_requests", () => {
  it("passes the status and search filters through", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({
      name: "list_brand_requests",
      arguments: { status: "recon_complete", search: "wax", limit: 10 },
    })
    expect(core.listBrandRequests).toHaveBeenCalledWith({
      status: "recon_complete",
      search: "wax",
      limit: 10,
      cursor: undefined,
    })
  })

  it("returns the query page unchanged", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_brand_requests", arguments: {} })
    expect(r.structuredContent).toEqual({ items: [REQUEST], next_cursor: null })
  })
})

describe("get_brand_request", () => {
  it("includes the recon payload", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "get_brand_request", arguments: { request_id: "br-1" } })
    expect((r.structuredContent as { recon: unknown }).recon).toEqual({ estimatedCost: 12 })
  })

  it("refuses an unknown id", async () => {
    core.getBrandRequestDetail.mockResolvedValue(null)
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "get_brand_request", arguments: { request_id: "x" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Request not found")
  })
})

describe("approve_brand_request (non-destructive)", () => {
  it("executes immediately and reports whether the monitor handoff fired", async () => {
    core.approveBrandRequest.mockResolvedValue({
      success: true,
      dispatched: false,
      auditId: "aud-approve",
    })
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "approve_brand_request",
      arguments: { request_id: "br-1" },
    })
    expect(core.approveBrandRequest).toHaveBeenCalledWith(ACTOR, "br-1", { withoutRecon: undefined })
    const body = r.structuredContent as {
      audit_id: string
      dispatched: boolean
      next_step: string
    }
    expect(body.audit_id).toBe("aud-approve")
    expect(body.dispatched).toBe(false)
    expect(body.next_step).toMatch(/retry_brand_request_dispatch/)
  })

  it("forwards the without_recon override", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({
      name: "approve_brand_request",
      arguments: { request_id: "br-1", without_recon: true },
    })
    expect(core.approveBrandRequest).toHaveBeenCalledWith(ACTOR, "br-1", { withoutRecon: true })
  })

  it("surfaces the core's recon-not-complete refusal", async () => {
    core.approveBrandRequest.mockRejectedValue(
      new Error("Recon has not completed yet. Wait for the cost estimate or approve without recon."),
    )
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "approve_brand_request",
      arguments: { request_id: "br-1" },
    })
    expect((r.content[0] as { text: string }).text).toMatch(/^Recon has not completed yet\./)
  })
})

describe("reject_brand_request (destructive)", () => {
  it("previews with the brand name and the reason, then executes", async () => {
    const { client } = await mcpTestClient()
    const args = { request_id: "br-1", reason: "Already covered by an existing brand" }
    const preview = await client.callTool({ name: "reject_brand_request", arguments: args })
    const body = preview.structuredContent as { preview: string; confirmation_token: string }
    expect(body.preview).toContain("Waxing Co")
    expect(body.preview).toContain("Already covered")
    expect(core.rejectBrandRequest).not.toHaveBeenCalled()

    const done = await client.callTool({
      name: "reject_brand_request",
      arguments: { ...args, confirmation_token: body.confirmation_token },
    })
    expect(core.rejectBrandRequest).toHaveBeenCalledWith(ACTOR, "br-1", args.reason)
    expect((done.structuredContent as { audit_id: string }).audit_id).toBe("aud-reject")
  })

  it("refuses a reason over 500 characters, matching the core's own cap", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_brand_request",
      arguments: { request_id: "br-1", reason: "x".repeat(501) },
    })
    expect(r.isError).toBe(true)
    expect(core.getBrandRequestDetail).not.toHaveBeenCalled()
  })

  it("re-runs the core's already-rejected rule before minting a token", async () => {
    core.getBrandRequestDetail.mockResolvedValue({ ...REQUEST, status: "rejected", recon: null })
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_brand_request",
      arguments: { request_id: "br-1", reason: "No longer needed" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Request is already rejected.")
  })

  it("re-runs the core's already-approved rule before minting a token", async () => {
    core.getBrandRequestDetail.mockResolvedValue({ ...REQUEST, status: "building", recon: null })
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_brand_request",
      arguments: { request_id: "br-1", reason: "No longer needed" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe(
      "Request is already approved and being set up — it can no longer be rejected.",
    )
  })
})

describe("retry_brand_request_dispatch (non-destructive)", () => {
  it("forwards the kind and returns the audit id", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "retry_brand_request_dispatch",
      arguments: { request_id: "br-1", kind: "build" },
    })
    expect(core.retryMonitorDispatch).toHaveBeenCalledWith(ACTOR, "br-1", "build")
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-retry")
  })

  it("rejects a kind outside recon/build at the schema", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "retry_brand_request_dispatch",
      arguments: { request_id: "br-1", kind: "deploy" },
    })
    expect(r.isError).toBe(true)
    expect(core.retryMonitorDispatch).not.toHaveBeenCalled()
  })
})

describe("list_inquiries", () => {
  it("projects an inquiry with its listing and seller context", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_inquiries", arguments: {} })
    expect((r.structuredContent as { items: Record<string, unknown>[] }).items[0]).toEqual({
      id: "c-1",
      at: "2026-09-10T00:00:00.000Z",
      message: "Interested",
      buyer: { name: "Sam", email: "sam@example.com", phone: null },
      listing: { id: "l-1", title: "Aspen", location: "Aspen Highlands", city: "Aspen", state: "CO" },
      seller: { name: "Dana", email: "dana@example.com" },
    })
  })

  it("reads a window far wider than the admin default of 100", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "list_inquiries", arguments: {} })
    expect(core.getInquiries).toHaveBeenCalledWith({ limit: 1000 })
  })

  it("filters by listing id and by since", async () => {
    core.getInquiries.mockResolvedValue([
      {
        id: "old",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        listingId: "l-1",
        message: null,
        buyerName: null,
        buyerEmail: null,
        buyerPhone: null,
        listingTitle: null,
        listingLocationName: null,
        listingCity: null,
        listingState: null,
        sellerName: null,
        sellerEmail: null,
      },
      {
        id: "new",
        createdAt: new Date("2026-09-10T00:00:00.000Z"),
        listingId: "l-2",
        message: null,
        buyerName: null,
        buyerEmail: null,
        buyerPhone: null,
        listingTitle: null,
        listingLocationName: null,
        listingCity: null,
        listingState: null,
        sellerName: null,
        sellerEmail: null,
      },
    ])
    const { client } = await mcpTestClient()
    const byListing = await client.callTool({
      name: "list_inquiries",
      arguments: { listing_id: "l-2" },
    })
    expect(
      (byListing.structuredContent as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual(["new"])
    const bySince = await client.callTool({
      name: "list_inquiries",
      arguments: { since: "2026-06-01T00:00:00.000Z" },
    })
    expect(
      (bySince.structuredContent as { items: { id: string }[] }).items.map((i) => i.id),
    ).toEqual(["new"])
  })
})

describe("scope gating", () => {
  it("hides the brand-request writes from a read-only token", async () => {
    const { client } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(["list_brand_requests", "get_brand_request", "list_inquiries"]),
    )
    for (const w of ["approve_brand_request", "reject_brand_request", "retry_brand_request_dispatch"]) {
      expect(names).not.toContain(w)
    }
  })
})
