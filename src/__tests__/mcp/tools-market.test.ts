import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Module mocks for every module the assembled server reaches.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  getCompetitorClosures: vi.fn(),
  listAlerts: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/competitor-query", () => ({ getCompetitorClosures: core.getCompetitorClosures }))
vi.mock("@/lib/mcp/queries/alerts", () => ({ listAlerts: core.listAlerts }))
// The harness builds the WHOLE server, so the other domains' modules load too.
// They are stubbed only so their `@/db` import never runs; no test here calls them.
vi.mock("@/lib/mcp/oauth/grants", () => ({
  listMcpConnections: vi.fn(),
  revokeMcpToken: vi.fn(),
}))
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
import type { CompetitorClosure } from "@/lib/competitor-query"

const CLOSURE: CompetitorClosure = {
  googlePlaceId: "gp-1",
  brandId: "waxing-co",
  brandName: "Waxing Co",
  address: "1 Main St",
  city: "Denver",
  state: "CO",
  latitude: 39.74,
  longitude: -104.99,
  businessStatus: "CLOSED_PERMANENTLY",
  closedAt: "2026-06-22T04:44:29.680Z",
  nearestHsName: "Hello Sugar Denver",
  nearestHsMiles: 1.8,
  isOpportunity: true,
  mapsUrl: "https://maps.example/gp-1",
}

type ClosureBody = { items: Record<string, unknown>[]; next_cursor: string | null }

beforeEach(() => {
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.getCompetitorClosures.mockResolvedValue([CLOSURE])
  core.listAlerts.mockResolvedValue({ items: [], next_cursor: null })
})

describe("list_competitor_closures", () => {
  it("projects a closure and keeps closed_at labelled as a DETECTION time", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_competitor_closures", arguments: {} })
    expect((r.structuredContent as ClosureBody).items[0]).toEqual({
      google_place_id: "gp-1",
      brand_id: "waxing-co",
      brand_name: "Waxing Co",
      address: "1 Main St",
      city: "Denver",
      state: "CO",
      latitude: 39.74,
      longitude: -104.99,
      business_status: "CLOSED_PERMANENTLY",
      closure_detected_at: "2026-06-22T04:44:29.680Z",
      nearest_hs_name: "Hello Sugar Denver",
      nearest_hs_miles: 1.8,
      is_opportunity: true,
      maps_url: "https://maps.example/gp-1",
    })
  })

  it("builds a scope from center and radius when all three are given", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({
      name: "list_competitor_closures",
      arguments: { center_lat: 39.74, center_lng: -104.99, radius_miles: 25, states: ["CO"] },
    })
    expect(core.getCompetitorClosures).toHaveBeenCalledWith({
      centerLat: 39.74,
      centerLng: -104.99,
      radiusMiles: 25,
      states: ["CO"],
    })
  })

  it("rejects a partial geo scope at the schema rather than ignoring the radius", async () => {
    const { client } = await mcpTestClient()
    // getCompetitorClosures only applies its bounding box and its precise filter when
    // all three geo fields are set, so this would otherwise return every closure in
    // the country as though the radius had been honoured.
    const r = await client.callTool({
      name: "list_competitor_closures",
      arguments: { center_lat: 39.74, radius_miles: 25 },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toMatch(/center_lat, center_lng and radius_miles/)
    expect(core.getCompetitorClosures).not.toHaveBeenCalled()
  })

  it("keeps states independent of the geo triple", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_competitor_closures",
      arguments: { states: ["CO"] },
    })
    expect(r.isError).toBeFalsy()
    expect(core.getCompetitorClosures).toHaveBeenCalledWith({
      centerLat: undefined,
      centerLng: undefined,
      radiusMiles: undefined,
      states: ["CO"],
    })
  })

  it("passes undefined — not a partial scope — when no filters are given", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "list_competitor_closures", arguments: {} })
    expect(core.getCompetitorClosures).toHaveBeenCalledWith(undefined)
  })

  it("filters to flagged opportunities in memory, without touching the scope", async () => {
    core.getCompetitorClosures.mockResolvedValue([
      CLOSURE,
      { ...CLOSURE, googlePlaceId: "gp-2", isOpportunity: false },
    ])
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "list_competitor_closures",
      arguments: { opportunities_only: true },
    })
    const body = r.structuredContent as ClosureBody
    expect(body.items.map((i) => i.google_place_id)).toEqual(["gp-1"])
    // opportunities_only is ours, not the scope filter's — it must not become a scope.
    expect(core.getCompetitorClosures).toHaveBeenCalledWith(undefined)
  })

  it("pages like every other list tool", async () => {
    core.getCompetitorClosures.mockResolvedValue([
      CLOSURE,
      { ...CLOSURE, googlePlaceId: "gp-2" },
    ])
    const { client } = await mcpTestClient()
    const first = await client.callTool({
      name: "list_competitor_closures",
      arguments: { limit: 1 },
    })
    const page1 = first.structuredContent as ClosureBody
    expect(page1.items.map((i) => i.google_place_id)).toEqual(["gp-1"])
    expect(page1.next_cursor).toBeTruthy()

    const second = await client.callTool({
      name: "list_competitor_closures",
      arguments: { limit: 1, cursor: page1.next_cursor as string },
    })
    const page2 = second.structuredContent as ClosureBody
    expect(page2.items.map((i) => i.google_place_id)).toEqual(["gp-2"])
    expect(page2.next_cursor).toBeNull()
  })

  it("still advertises every input field after the all-or-nothing geo refinement", async () => {
    const { client } = await mcpTestClient()
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === "list_competitor_closures",
    )
    // A zod wrapper that lost the object shape would ship an empty schema and the
    // model would never learn these fields exist.
    expect(Object.keys(tool?.inputSchema.properties ?? {}).sort()).toEqual([
      "center_lat",
      "center_lng",
      "cursor",
      "limit",
      "opportunities_only",
      "radius_miles",
      "states",
    ])
  })

  it("advertises no write tool for competitor data", async () => {
    const { client } = await mcpTestClient()
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names.filter((n) => n.includes("competitor"))).toEqual(["list_competitor_closures"])
  })
})

describe("list_alerts", () => {
  it("forwards the filters to the query", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({
      name: "list_alerts",
      arguments: { user_id: "u-2", origin: "owner-auto", notify_enabled: true, limit: 10 },
    })
    expect(core.listAlerts).toHaveBeenCalledWith({
      userId: "u-2",
      origin: "owner-auto",
      notifyEnabled: true,
      limit: 10,
      cursor: undefined,
    })
  })

  it("applies the house default page size when no limit is given", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "list_alerts", arguments: {} })
    expect(core.listAlerts).toHaveBeenCalledWith({
      userId: undefined,
      origin: undefined,
      notifyEnabled: undefined,
      limit: 25,
      cursor: undefined,
    })
  })

  it("returns the query page unchanged", async () => {
    core.listAlerts.mockResolvedValue({ items: [{ id: "a-1" }], next_cursor: "N" })
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_alerts", arguments: {} })
    expect(r.structuredContent).toEqual({ items: [{ id: "a-1" }], next_cursor: "N" })
  })

  it("records one mcp.read audit row per market read", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({ name: "list_alerts", arguments: { limit: 5 } })
    expect(core.recordMcpRead).toHaveBeenCalledWith(
      { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" },
      "list_alerts",
      { limit: 5 },
    )
  })
})
