/**
 * The pre-registered OAuth clients (spec section 4.1).
 *
 * NOT a `"use server"` module, and deliberately free of any `@/db`,
 * `@/lib/env` or `server-only` import: scripts/seed-mcp-clients.ts runs under
 * `tsx`, outside Next's bundler, where `server-only` is unresolvable and would
 * crash the script on startup.
 *
 * There is no Dynamic Client Registration in v1, so this list IS the client
 * registry. Adding an entry means running the seed script again.
 */
export interface McpSeedClient {
  clientId: string
  name: string
  redirectUris: string[]
  isPublic: boolean
}

export const MCP_SEED_CLIENTS: McpSeedClient[] = [
  {
    clientId: "claude-hosted",
    name: "Claude (claude.ai)",
    // Claude.ai's fixed callback. Exact match — no loopback exemption applies.
    redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    isPublic: true,
  },
  {
    clientId: "claude-code",
    name: "Claude Code",
    // Both loopback spellings. The PORT IS IGNORED when matching these
    // (RFC 8252 section 7.3) because Claude Code binds an ephemeral port it
    // cannot register ahead of time — see redirectUriMatches.
    redirectUris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    isPublic: true,
  },
]
