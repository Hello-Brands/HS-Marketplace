import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))

const core = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  unresolvedMappings: vi.fn(),
  setLocationMapping: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead: core.recordMcpRead }))
vi.mock("@/lib/mcp/queries/data-mappings", () => ({ unresolvedMappings: core.unresolvedMappings }))
vi.mock("@/lib/admin/core/data-mappings", () => ({ setLocationMapping: core.setLocationMapping }))
// The harness builds the WHOLE server, so the other domains' modules load too.
// They are stubbed only so their `@/db` import never runs; no test here calls them.
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

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import { __resetRateLimits } from "@/lib/rate-limit"
import type { UnresolvedMapping } from "@/lib/mcp/queries/data-mappings"

const ACTOR = { userId: "u-1", source: "mcp", clientId: "claude-code", tokenId: "tok-1" }

beforeEach(() => {
  __resetRateLimits()
  for (const fn of Object.values(core)) fn.mockReset()
  core.recordMcpRead.mockResolvedValue("audit-read")
  core.unresolvedMappings.mockResolvedValue({
    items: [
      {
        location_id: "loc-1",
        location_name: "Hello Sugar Austin South",
        listing: { id: "l-1", title: "Austin South", status: "pending" },
        status: "unconfirmed",
        current_bq_location_name: null,
        suggestion: { bq_location_name: "Austin South", confidence: 0.86 },
      },
    ],
    bq_configured: true,
  })
  core.setLocationMapping.mockResolvedValue({ ok: true, auditId: "aud-map" })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

type MappingBody = { items: UnresolvedMapping[]; bq_configured: boolean }

describe("list_unresolved_data_mappings", () => {
  it("returns the blocking locations with their suggested BigQuery names", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_unresolved_data_mappings", arguments: {} })
    const body = r.structuredContent as MappingBody
    expect(body.items[0].suggestion).toEqual({ bq_location_name: "Austin South", confidence: 0.86 })
    expect(body.bq_configured).toBe(true)
  })

  it("still lists the locations when BigQuery is unavailable, with no suggestions", async () => {
    core.unresolvedMappings.mockResolvedValue({
      items: [
        {
          location_id: "loc-1",
          location_name: "Hello Sugar Austin South",
          listing: null,
          status: "unconfirmed",
          current_bq_location_name: null,
          suggestion: null,
        },
      ],
      bq_configured: false,
    })
    const { client } = await mcpTestClient()
    const r = await client.callTool({ name: "list_unresolved_data_mappings", arguments: {} })
    const body = r.structuredContent as MappingBody
    expect(body.bq_configured).toBe(false)
    expect(body.items[0].suggestion).toBeNull()
  })
})

describe("set_location_data_mapping (non-destructive)", () => {
  it("confirms a mapping to a BigQuery location name", async () => {
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_location_data_mapping",
      arguments: { location_id: "loc-1", status: "confirmed", bq_location_name: "Austin South" },
    })
    expect(core.setLocationMapping).toHaveBeenCalledWith(ACTOR, "loc-1", {
      bqLocationName: "Austin South",
      status: "confirmed",
    })
    expect((r.structuredContent as { audit_id: string }).audit_id).toBe("aud-map")
  })

  it("marks a location not_connected with a null name", async () => {
    const { client } = await mcpTestClient()
    await client.callTool({
      name: "set_location_data_mapping",
      arguments: { location_id: "loc-1", status: "not_connected" },
    })
    expect(core.setLocationMapping).toHaveBeenCalledWith(ACTOR, "loc-1", {
      bqLocationName: null,
      status: "not_connected",
    })
  })

  it("surfaces the core's refusal when confirming without a name", async () => {
    core.setLocationMapping.mockResolvedValue({
      ok: false,
      error: "A location is required to confirm.",
    })
    const { client } = await mcpTestClient()
    const r = await client.callTool({
      name: "set_location_data_mapping",
      arguments: { location_id: "loc-1", status: "confirmed" },
    })
    expect(r.isError).toBe(true)
    expect((r.content[0] as { text: string }).text).toBe("A location is required to confirm.")
  })
})

describe("scope gating", () => {
  it("hides the mapping write from a read-only token", async () => {
    const { client } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain("list_unresolved_data_mappings")
    expect(names).not.toContain("set_location_data_mapping")
  })
})
