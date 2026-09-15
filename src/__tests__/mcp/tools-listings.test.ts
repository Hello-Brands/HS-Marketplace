import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  getAllListings: vi.fn(),
  approveListing: vi.fn(),
  rejectListing: vi.fn(),
  adminUpdateListing: vi.fn(),
  adminMarkSold: vi.fn(),
  queryAdminListing: vi.fn(),
  listingExtras: vi.fn(),
  marketplaceOverview: vi.fn(),
  getRecentActivity: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/admin/core/listings", () => ({
  getAllListings: core.getAllListings,
  approveListing: core.approveListing,
  rejectListing: core.rejectListing,
  adminUpdateListing: core.adminUpdateListing,
  adminMarkSold: core.adminMarkSold,
}))
vi.mock("@/lib/listings/load-listing", () => ({ queryAdminListing: core.queryAdminListing }))
vi.mock("@/lib/mcp/queries/listings", () => ({ listingExtras: core.listingExtras }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview: core.marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog: core.listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity: core.getRecentActivity }))
// The harness builds the WHOLE server, so the other domains' modules load too.
// They are stubbed only so their `@/db` import never runs; no test here calls them.
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
import { __resetRateLimits } from "@/lib/rate-limit"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

function listingRow(over: Record<string, unknown> = {}) {
  return {
    id: "l-1",
    sellerId: "s-1",
    type: "suite",
    status: "pending",
    title: "Aspen Highlands",
    askingPrice: 12345600,
    ttmProfit: 4500000,
    inventoryIncluded: true,
    laserIncluded: false,
    inventoryCostEstimate: 250000,
    otherAssets: null,
    reasonForSelling: "Relocating",
    notes: null,
    rejectionReason: null,
    viewCount: 12,
    inquiryCount: 2,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    listedAt: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    locations: [
      {
        id: "loc-1",
        name: "Aspen Highlands",
        locationType: "salon",
        city: "Aspen",
        state: "CO",
        dataMappingStatus: "confirmed",
        displayOrder: 0,
      },
    ],
    photos: [{ id: "p-1", url: "https://blob/p1.jpg", displayOrder: 0 }],
    seller: { id: "s-1", name: "Dana", email: "dana@example.com" },
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
  core.getAllListings.mockResolvedValue([listingRow()])
  core.queryAdminListing.mockResolvedValue(listingRow())
  core.listingExtras.mockResolvedValue({
    recent_inquiries: [],
    views: { counter: 12, distinct_viewers: 9 },
    audit_history: [],
  })
  core.approveListing.mockResolvedValue({ success: true, auditId: "aud-approve" })
  core.rejectListing.mockResolvedValue({ success: true, auditId: "aud-reject" })
  core.adminUpdateListing.mockResolvedValue({ success: true, auditId: "aud-update" })
  core.adminMarkSold.mockResolvedValue({ success: true, auditId: "aud-sold" })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("list_listings", () => {
  it("projects money as cents plus a formatted string", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_listings", arguments: {} })
    const items = (r.structuredContent as { items: Record<string, unknown>[] }).items
    expect(items[0].asking_price).toEqual({ cents: 12345600, formatted: "$123,456" })
    expect(items[0].ttm_profit).toEqual({ cents: 4500000, formatted: "$45,000" })
  })

  it("passes a status filter straight to the core read", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "list_listings", arguments: { status: "pending" } })
    expect(core.getAllListings).toHaveBeenCalledWith("pending")
  })

  it("filters in memory by type, state, seller and search", async () => {
    core.getAllListings.mockResolvedValue([
      listingRow({ id: "a", title: "Aspen", type: "suite" }),
      listingRow({ id: "b", title: "Boulder", type: "territory" }),
    ])
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_listings",
      arguments: { type: "territory", search: "bould" },
    })
    const items = (r.structuredContent as { items: { id: string }[] }).items
    expect(items.map((i) => i.id)).toEqual(["b"])
  })

  it("paginates with an opaque cursor", async () => {
    core.getAllListings.mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => listingRow({ id: `l${i}` })),
    )
    const { client } = await mcpTestClient()
    const first = await client.callTool({ name: "list_listings", arguments: { limit: 2 } })
    const page1 = first.structuredContent as { items: { id: string }[]; next_cursor: string }
    expect(page1.items.map((i) => i.id)).toEqual(["l0", "l1"])
    const second = await client.callTool({
      name: "list_listings",
      arguments: { limit: 2, cursor: page1.next_cursor },
    })
    const page2 = second.structuredContent as { items: { id: string }[]; next_cursor: null }
    expect(page2.items.map((i) => i.id)).toEqual(["l2", "l3"])
    expect(page2.next_cursor).toBeNull()
  })

  it("rejects a search string over 200 characters at the schema", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_listings",
      arguments: { search: "x".repeat(201) },
    })
    expect(r.isError).toBe(true)
    expect(core.getAllListings).not.toHaveBeenCalled()
  })
})

describe("get_listing", () => {
  it("returns the listing with locations, photos, seller and the extras", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "get_listing", arguments: { listing_id: "l-1" } })
    const body = r.structuredContent as {
      listing: {
        id: string
        locations: { name: string }[]
        photos: unknown[]
        seller: unknown
      }
      views: unknown
      recent_inquiries: unknown
      audit_history: unknown
    }
    expect(body.listing.id).toBe("l-1")
    expect(body.listing.locations[0].name).toBe("Aspen Highlands")
    expect(body.listing.photos).toHaveLength(1)
    expect(body.listing.seller).toEqual({ id: "s-1", name: "Dana", email: "dana@example.com" })
    expect(body.views).toEqual({ counter: 12, distinct_viewers: 9 })
    expect(body.recent_inquiries).toEqual([])
    expect(body.audit_history).toEqual([])
  })

  it("returns the UI's own message when the listing does not exist", async () => {
    core.queryAdminListing.mockResolvedValue(undefined)
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "get_listing", arguments: { listing_id: "nope" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Listing not found")
  })
})

describe("approve_listing (non-destructive)", () => {
  it("executes on the first call with no confirmation token", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "approve_listing", arguments: { listing_id: "l-1" } })
    expect(core.approveListing).toHaveBeenCalledWith(ACTOR, "l-1")
    const body = r.structuredContent as { audit_id: string; target: { id: string } }
    expect(body.audit_id).toBe("aud-approve")
    expect(body.target.id).toBe("l-1")
  })

  it("has no confirmation_token in its schema", async () => {
    const { client } = await mcpTestClient()
    const tool = (await client.listTools()).tools.find((t) => t.name === "approve_listing")!
    expect(JSON.stringify(tool.inputSchema)).not.toContain("confirmation_token")
    expect(tool.annotations?.destructiveHint).toBe(false)
  })

  it("surfaces the core's unresolved-mapping refusal verbatim", async () => {
    core.approveListing.mockRejectedValue(new Error("Confirm data mapping for: Aspen Highlands"))
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "approve_listing", arguments: { listing_id: "l-1" } })
    expect((r.content[0] as { text: string }).text).toBe("Confirm data mapping for: Aspen Highlands")
  })
})

describe("reject_listing (destructive)", () => {
  it("previews and changes nothing without a token", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "Duplicate of L-7" },
    })
    const body = r.structuredContent as {
      preview: string
      expires_in: number
      confirmation_token: unknown
    }
    expect(body.preview).toContain("Aspen Highlands")
    expect(body.preview).toContain("Duplicate of L-7")
    expect(body.expires_in).toBe(600)
    expect(typeof body.confirmation_token).toBe("string")
    expect(core.rejectListing).not.toHaveBeenCalled()
  })

  it("executes when the token is passed back with identical arguments", async () => {
    const { client } = await mcpTestClient()
    const args = { listing_id: "l-1", reason: "Duplicate of L-7" }
    const preview = await client.callTool({ name: "reject_listing", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const done = await client.callTool({
      name: "reject_listing",
      arguments: { ...args, confirmation_token: token },
    })
    expect(core.rejectListing).toHaveBeenCalledWith(ACTOR, "l-1", "Duplicate of L-7", undefined)
    expect((done.structuredContent as { audit_id: string }).audit_id).toBe("aud-reject")
  })

  it("refuses a token minted for a different reason", async () => {
    const { client } = await mcpTestClient()
    const preview = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "Duplicate of L-7" },
    })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const r = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "Actually, spam", confirmation_token: token },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toMatch(/does not match these arguments/)
    expect(core.rejectListing).not.toHaveBeenCalled()
  })

  it("runs the state-machine pre-check BEFORE issuing a token", async () => {
    core.queryAdminListing.mockResolvedValue(listingRow({ status: "sold" }))
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "Duplicate" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("Cannot reject listing with status sold")
    expect(r.structuredContent).not.toHaveProperty("confirmation_token")
  })

  it("advertises itself as destructive and requiring user interaction", async () => {
    const { client } = await mcpTestClient()
    const tool = (await client.listTools()).tools.find((t) => t.name === "reject_listing")!
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    })
    expect(tool._meta).toMatchObject({ "anthropic/requiresUserInteraction": true })
  })

  it("rejects an empty reason at the schema", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "reject_listing",
      arguments: { listing_id: "l-1", reason: "   " },
    })
    expect(r.isError).toBe(true)
    expect(core.queryAdminListing).not.toHaveBeenCalled()
  })
})

describe("update_listing (destructive)", () => {
  it("validates the patch with parseListingPatch before issuing a token", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "update_listing",
      arguments: { listing_id: "l-1", patch: { notes: "x".repeat(2001) } },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toMatch(/^Invalid listing data — /)
    expect(core.adminUpdateListing).not.toHaveBeenCalled()
  })

  it("refuses a patch with no recognised fields before issuing a token", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "update_listing",
      arguments: { listing_id: "l-1", patch: { totallyMadeUp: 1 } },
    })
    expect(r.isError).toBe(true)
    expect(r.structuredContent).not.toHaveProperty("confirmation_token")
    expect(core.adminUpdateListing).not.toHaveBeenCalled()
  })

  it("hands the RAW patch to the core so it applies its own dollars-to-cents rule", async () => {
    // Nothing stored to preserve, so the patch reaches the core exactly as sent.
    core.queryAdminListing.mockResolvedValue(listingRow({ inventoryCostEstimate: null }))
    const { client } = await mcpTestClient()
    const args = { listing_id: "l-1", patch: { askingPrice: 150000, notes: "Price drop" } }
    const preview = await client.callTool({ name: "update_listing", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    await client.callTool({
      name: "update_listing",
      arguments: { ...args, confirmation_token: token },
    })
    expect(core.adminUpdateListing).toHaveBeenCalledWith(ACTOR, "l-1", {
      askingPrice: 150000,
      notes: "Price drop",
    })
  })

  it("re-sends the stored inventory cost (in dollars) when the patch omits it", async () => {
    // A patch here is genuinely partial, unlike the admin form, which posts every key.
    // Without this the core's buildListingUpdate would clear the stored 250000 cents.
    const { client } = await mcpTestClient()
    const args = { listing_id: "l-1", patch: { notes: "Just a note" } }
    const preview = await client.callTool({ name: "update_listing", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    await client.callTool({
      name: "update_listing",
      arguments: { ...args, confirmation_token: token },
    })
    expect(core.adminUpdateListing).toHaveBeenCalledWith(ACTOR, "l-1", {
      notes: "Just a note",
      inventoryCostEstimate: 2500,
    })
  })

  it("does not re-send the cost when the patch turns inventory off", async () => {
    const { client } = await mcpTestClient()
    const args = { listing_id: "l-1", patch: { inventoryIncluded: false } }
    const preview = await client.callTool({ name: "update_listing", arguments: args })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    await client.callTool({
      name: "update_listing",
      arguments: { ...args, confirmation_token: token },
    })
    expect(core.adminUpdateListing).toHaveBeenCalledWith(ACTOR, "l-1", {
      inventoryIncluded: false,
    })
  })

  it("names the changed fields in the preview", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "update_listing",
      arguments: { listing_id: "l-1", patch: { askingPrice: 150000, notes: "Price drop" } },
    })
    expect((r.structuredContent as { preview: string }).preview).toContain("askingPrice, notes")
  })
})

describe("mark_listing_sold (destructive)", () => {
  it("blocks at the pre-check when the listing is not active", async () => {
    core.queryAdminListing.mockResolvedValue(listingRow({ status: "pending" }))
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "mark_listing_sold", arguments: { listing_id: "l-1" } })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe(
      "Cannot mark listing as sold from status pending",
    )
  })

  it("previews then executes for an active listing", async () => {
    core.queryAdminListing.mockResolvedValue(listingRow({ status: "active" }))
    const { client } = await mcpTestClient()
    const preview = await client.callTool({
      name: "mark_listing_sold",
      arguments: { listing_id: "l-1" },
    })
    const token = (preview.structuredContent as { confirmation_token: string }).confirmation_token
    const done = await client.callTool({
      name: "mark_listing_sold",
      arguments: { listing_id: "l-1", confirmation_token: token },
    })
    expect(core.adminMarkSold).toHaveBeenCalledWith(ACTOR, "l-1")
    expect((done.structuredContent as { audit_id: string }).audit_id).toBe("aud-sold")
  })
})

describe("scope gating", () => {
  it("hides every listing write tool from a read-only token", async () => {
    const { client } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain("list_listings")
    expect(names).toContain("get_listing")
    for (const w of ["approve_listing", "reject_listing", "update_listing", "mark_listing_sold"]) {
      expect(names).not.toContain(w)
    }
  })
})
