import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Module mocks for every module the assembled server reaches.
// Later domain tool tasks (listings, users, brand requests, owner links,
// connections) APPEND their module mocks to this one block — keep it here, at
// the top, as the single place the server's dependencies are stubbed.
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}))

const { recordMcpRead, marketplaceOverview, getRecentActivity, listAuditLog } = vi.hoisted(() => ({
  recordMcpRead: vi.fn(),
  marketplaceOverview: vi.fn(),
  getRecentActivity: vi.fn(),
  listAuditLog: vi.fn(),
}))

vi.mock("@/lib/admin/audit", () => ({ recordMcpRead }))
vi.mock("@/lib/mcp/queries/overview", () => ({ marketplaceOverview }))
vi.mock("@/lib/mcp/queries/audit", () => ({ listAuditLog }))
vi.mock("@/lib/admin/activity", () => ({ getRecentActivity }))
// --------------------------- end of mock block -----------------------------

import { mcpTestClient } from "../../../test/helpers/mcp-harness"
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  WRITE_TOOL_NAMES,
  buildMcpServer,
} from "@/lib/mcp/server"

beforeEach(() => {
  recordMcpRead.mockReset().mockResolvedValue("audit-1")
  marketplaceOverview.mockReset().mockResolvedValue({ listings: { total: 0, by_status: {} } })
  getRecentActivity.mockReset().mockResolvedValue({ items: [], nextCursor: null })
  listAuditLog.mockReset().mockResolvedValue({ items: [], next_cursor: null })
})

describe("buildMcpServer", () => {
  it("returns a fresh instance per call — never a shared one", () => {
    const actor = {
      userId: "u-1",
      email: null,
      scopes: ["marketplace:read"],
      clientId: "claude-code",
      tokenId: "t1",
    }
    expect(buildMcpServer(actor)).not.toBe(buildMcpServer(actor))
  })
})

describe("server identity", () => {
  it("announces itself with the house naming convention", async () => {
    expect(MCP_SERVER_NAME).toBe("hs-marketplace-mcp-server")
    expect(MCP_SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe("tools/list scope filtering", () => {
  it("advertises the read tools to a read-only token", async () => {
    const { client } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain("get_marketplace_overview")
    expect(names).toContain("list_recent_activity")
    expect(names).toContain("list_audit_log")
  })

  it("advertises no tool that is in the write set to a read-only token", async () => {
    const { client } = await mcpTestClient({ scopes: ["marketplace:read"] })
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const write of WRITE_TOOL_NAMES) expect(names).not.toContain(write)
  })

  it("marks every advertised tool closed-world", async () => {
    const { client } = await mcpTestClient()
    for (const tool of (await client.listTools()).tools) {
      expect(tool.annotations?.openWorldHint).toBe(false)
    }
  })

  it("gives every advertised tool a title, a description and an input schema", async () => {
    const { client } = await mcpTestClient()
    for (const tool of (await client.listTools()).tools) {
      expect(tool.title, tool.name).toBeTruthy()
      expect(tool.description, tool.name).toBeTruthy()
      expect(tool.inputSchema, tool.name).toBeTruthy()
    }
  })
})

describe("tools/call transport round trip", () => {
  it("returns structuredContent through a real client", async () => {
    marketplaceOverview.mockResolvedValue({ listings: { total: 3, by_status: { active: 3 } } })
    const { client } = await mcpTestClient()
    const result = await client.callTool({ name: "get_marketplace_overview", arguments: {} })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ listings: { total: 3, by_status: { active: 3 } } })
  })

  it("rejects an out-of-range limit before the handler runs", async () => {
    const { client } = await mcpTestClient()
    const result = await client.callTool({
      name: "list_audit_log",
      arguments: { limit: 5000 },
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/validation/i)
    expect(listAuditLog).not.toHaveBeenCalled()
  })

  it("reports an unknown tool as an error rather than crashing the connection", async () => {
    const { client } = await mcpTestClient()
    // SDK v2 answers an unknown tool with a JSON-RPC protocol error, not an in-band
    // `isError` result (that shape is reserved for a tool that ran and refused), so
    // the client surfaces it as a rejection.
    await expect(client.callTool({ name: "delete_everything", arguments: {} })).rejects.toThrow(
      /delete_everything not found/,
    )
    // The point of the test: the session survives it and the next call still works.
    const after = await client.callTool({ name: "get_marketplace_overview", arguments: {} })
    expect(after.isError).toBeFalsy()
  })
})
