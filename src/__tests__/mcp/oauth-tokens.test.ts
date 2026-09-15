import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import {
  generateOpaqueToken,
  sha256Hex,
  verifyPkceS256,
  redirectUriMatches,
} from "@/lib/mcp/oauth/tokens"
import { MCP_SCOPES, isMcpScope, parseScopeString } from "@/lib/mcp/oauth/scopes"

describe("generateOpaqueToken", () => {
  it("returns 32 bytes of entropy, base64url encoded", () => {
    const token = generateOpaqueToken()
    // 32 bytes -> 43 base64url chars, no padding, no + or /
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, "base64url")).toHaveLength(32)
  })

  it("never repeats across a large sample", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOpaqueToken()))
    expect(seen.size).toBe(500)
  })
})

describe("sha256Hex", () => {
  it("is the SHA-256 hex digest of the UTF-8 bytes", () => {
    expect(sha256Hex("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    )
  })

  it("is stable and 64 hex characters wide", () => {
    const token = generateOpaqueToken()
    expect(sha256Hex(token)).toBe(sha256Hex(token))
    expect(sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/)
  })

  it("differs for values that differ by one character", () => {
    expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"))
  })
})

describe("verifyPkceS256", () => {
  // The worked example from RFC 7636 Appendix B.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

  it("accepts the RFC 7636 Appendix B vector", () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true)
  })

  it("accepts a freshly generated verifier/challenge pair", () => {
    const v = generateOpaqueToken()
    const c = createHash("sha256").update(v, "ascii").digest("base64url")
    expect(verifyPkceS256(v, c)).toBe(true)
  })

  it("rejects a verifier that does not hash to the challenge", () => {
    expect(verifyPkceS256("wrong-verifier", challenge)).toBe(false)
  })

  it("rejects the base64 (non-url) spelling of the same digest", () => {
    // A client that sent standard base64 must fail rather than half-match.
    const standard = createHash("sha256").update(verifier, "ascii").digest("base64")
    expect(standard).not.toBe(challenge)
    expect(verifyPkceS256(verifier, standard)).toBe(false)
  })

  it("rejects empty inputs instead of treating them as a match", () => {
    expect(verifyPkceS256("", "")).toBe(false)
    expect(verifyPkceS256(verifier, "")).toBe(false)
    expect(verifyPkceS256("", challenge)).toBe(false)
  })
})

describe("redirectUriMatches", () => {
  const hosted = ["https://claude.ai/api/mcp/auth_callback"]
  const code = ["http://localhost/callback", "http://127.0.0.1/callback"]

  it("accepts an exact match", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai/api/mcp/auth_callback")).toBe(true)
  })

  it("rejects a different path on the registered host", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai/api/mcp/evil")).toBe(false)
  })

  it("rejects a lookalike host", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai.evil.com/api/mcp/auth_callback")).toBe(false)
  })

  it("rejects an added query string on a non-loopback URI", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false)
  })

  it("ignores the port on a loopback URI (RFC 8252 §7.3)", () => {
    // Claude Code binds an ephemeral port it cannot register ahead of time.
    expect(redirectUriMatches(code, "http://localhost:54321/callback")).toBe(true)
    expect(redirectUriMatches(code, "http://127.0.0.1:8976/callback")).toBe(true)
  })

  it("still requires the loopback path to match", () => {
    expect(redirectUriMatches(code, "http://localhost:54321/steal")).toBe(false)
  })

  it("does not extend the port exemption to non-loopback hosts", () => {
    expect(redirectUriMatches(hosted, "https://claude.ai:8443/api/mcp/auth_callback")).toBe(false)
  })

  it("does not treat an https loopback as matching an http registration", () => {
    expect(redirectUriMatches(code, "https://localhost:54321/callback")).toBe(false)
  })

  it("rejects a host that merely contains 'localhost'", () => {
    expect(redirectUriMatches(code, "http://localhost.evil.com:80/callback")).toBe(false)
  })

  it("rejects an unparseable URI without throwing", () => {
    expect(() => redirectUriMatches(code, "not a url")).not.toThrow()
    expect(redirectUriMatches(code, "not a url")).toBe(false)
  })

  it("rejects everything when the client registered no URIs", () => {
    expect(redirectUriMatches([], "http://localhost:1234/callback")).toBe(false)
  })
})

describe("scopes", () => {
  it("exposes exactly the two supported scopes, in order", () => {
    expect(MCP_SCOPES).toEqual(["marketplace:read", "marketplace:write"])
  })

  it("recognises supported scopes and nothing else", () => {
    expect(isMcpScope("marketplace:read")).toBe(true)
    expect(isMcpScope("marketplace:write")).toBe(true)
    expect(isMcpScope("marketplace:admin")).toBe(false)
    expect(isMcpScope("")).toBe(false)
  })

  it("parses a space-separated scope string", () => {
    expect(parseScopeString("marketplace:read marketplace:write")).toEqual([
      "marketplace:read",
      "marketplace:write",
    ])
  })

  it("tolerates extra whitespace", () => {
    expect(parseScopeString("  marketplace:read   marketplace:write  ")).toEqual([
      "marketplace:read",
      "marketplace:write",
    ])
  })

  it("defaults an absent or empty scope to every supported scope", () => {
    // The consent screen narrows this down; an omitted scope must not mean none.
    expect(parseScopeString(null)).toEqual(["marketplace:read", "marketplace:write"])
    expect(parseScopeString("   ")).toEqual(["marketplace:read", "marketplace:write"])
  })

  it("returns null when any requested scope is unknown", () => {
    expect(parseScopeString("marketplace:read marketplace:delete")).toBeNull()
  })

  it("de-duplicates repeated scopes", () => {
    expect(parseScopeString("marketplace:read marketplace:read")).toEqual([
      "marketplace:read",
    ])
  })
})
