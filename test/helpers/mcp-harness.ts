/**
 * Loopback MCP client for tool tests.
 *
 * Drives the REAL `createMcpRequestHandler` in-process: the client transport's
 * `fetch` is the handler's own `fetch`, so nothing is listening on a socket but the
 * full Streamable HTTP path — protocol negotiation, schema validation, result
 * projection — runs exactly as it does on Vercel.
 *
 * Deliberately NOT `InMemoryTransport.createLinkedPair()`: in SDK v2 that pair
 * connects 2025-era instances only, so it would not exercise the protocol revision
 * this endpoint actually serves.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { createMcpRequestHandler } from "@/lib/mcp/server"
import type { McpActor } from "@/lib/mcp/auth/verify-token"

/** The actor every tool test gets unless it overrides a field (e.g. `scopes`). */
export const TEST_ACTOR: McpActor = {
  userId: "u-1",
  email: "admin@hellosugar.salon",
  scopes: ["marketplace:read", "marketplace:write"],
  clientId: "claude-code",
  tokenId: "tok-1",
}

export async function mcpTestClient(
  overrides: Partial<McpActor> = {},
): Promise<{ client: Client; close: () => Promise<void> }> {
  const actor: McpActor = { ...TEST_ACTOR, ...overrides }
  const handler = createMcpRequestHandler(actor)

  // The URL is never dialled — `fetch` short-circuits into the handler.
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.test/api/mcp"), {
    fetch: (url: URL | string, init?: RequestInit) => handler.fetch(new Request(url, init)),
  })

  const client = new Client(
    { name: "hs-marketplace-test-harness", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } },
  )
  await client.connect(transport)

  return {
    client,
    close: async () => {
      await client.close()
      await handler.close()
    },
  }
}
