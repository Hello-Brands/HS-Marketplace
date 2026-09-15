import { describe, it, expect } from "vitest"
import { MCP_SEED_CLIENTS } from "@/lib/mcp/oauth/seed-clients"
import { redirectUriMatches } from "@/lib/mcp/oauth/tokens"

const byId = (id: string) => MCP_SEED_CLIENTS.find((c) => c.clientId === id)!

describe("MCP_SEED_CLIENTS", () => {
  it("defines exactly the two pre-registered clients", () => {
    expect(MCP_SEED_CLIENTS.map((c) => c.clientId)).toEqual([
      "claude-hosted",
      "claude-code",
    ])
  })

  it("registers both as public clients (PKCE only, no secret)", () => {
    expect(MCP_SEED_CLIENTS.every((c) => c.isPublic)).toBe(true)
  })

  it("gives every client a display name for the consent screen", () => {
    expect(MCP_SEED_CLIENTS.every((c) => c.name.trim().length > 0)).toBe(true)
  })

  it("registers Claude.ai's exact callback URL", () => {
    // A typo here only surfaces as a mystifying error page mid-connection.
    expect(byId("claude-hosted").redirectUris).toEqual([
      "https://claude.ai/api/mcp/auth_callback",
    ])
  })

  it("accepts the real Claude.ai callback and rejects a lookalike", () => {
    const uris = byId("claude-hosted").redirectUris
    expect(redirectUriMatches(uris, "https://claude.ai/api/mcp/auth_callback")).toBe(true)
    expect(redirectUriMatches(uris, "https://claude.ai.evil.com/api/mcp/auth_callback")).toBe(
      false,
    )
  })

  it("registers both loopback spellings for Claude Code", () => {
    expect(byId("claude-code").redirectUris).toEqual([
      "http://localhost/callback",
      "http://127.0.0.1/callback",
    ])
  })

  it("accepts Claude Code's ephemeral port on either loopback host", () => {
    const uris = byId("claude-code").redirectUris
    expect(redirectUriMatches(uris, "http://localhost:49512/callback")).toBe(true)
    expect(redirectUriMatches(uris, "http://127.0.0.1:49512/callback")).toBe(true)
    expect(redirectUriMatches(uris, "http://localhost:49512/not-the-callback")).toBe(false)
  })

  it("registers no https redirect for Claude Code and no loopback for Claude.ai", () => {
    expect(byId("claude-code").redirectUris.every((u) => u.startsWith("http://"))).toBe(true)
    expect(
      byId("claude-hosted").redirectUris.every((u) => u.startsWith("https://")),
    ).toBe(true)
  })
})
