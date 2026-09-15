import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Tests the REAL route handlers under src/app/.well-known/**. Nothing is
 * mocked except the environment — these documents are pure functions of the
 * issuer URL, and their exact key set is a contract with Claude's client.
 */

import {
  GET as authServerGet,
  OPTIONS as authServerOptions,
} from "@/app/.well-known/oauth-authorization-server/route"
import {
  GET as prGet,
  OPTIONS as prOptions,
} from "@/app/.well-known/oauth-protected-resource/route"
import {
  GET as prSuffixedGet,
  OPTIONS as prSuffixedOptions,
} from "@/app/.well-known/oauth-protected-resource/api/mcp/route"

const ISSUER = "https://marketplace.hellosugar.salon"

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ISSUER)
  vi.stubEnv("MCP_ISSUER_URL", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("authorization server metadata (RFC 8414)", () => {
  it("advertises the endpoints, grants and PKCE method the server implements", async () => {
    const res = await authServerGet()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/mcp/authorize`,
      token_endpoint: `${ISSUER}/mcp/token`,
      revocation_endpoint: `${ISSUER}/mcp/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["marketplace:read", "marketplace:write"],
      authorization_response_iss_parameter_supported: true,
    })
  })

  it("omits registration_endpoint and CIMD support (v1 has no DCR)", async () => {
    const body = await (await authServerGet()).json()
    expect(body).not.toHaveProperty("registration_endpoint")
    expect(body).not.toHaveProperty("client_id_metadata_document_supported")
  })

  it("never advertises the plain PKCE method", async () => {
    const body = await (await authServerGet()).json()
    expect(body.code_challenge_methods_supported).not.toContain("plain")
  })

  it("serves JSON with permissive CORS so a browser-based client can read it", async () => {
    const res = await authServerGet()
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS")
    expect(res.headers.get("access-control-allow-headers")).toBe("*")
  })

  it("answers the CORS preflight with 204 and the same headers", async () => {
    const res = await authServerOptions()
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS")
    expect(res.headers.get("access-control-allow-headers")).toBe("*")
  })

  it("follows MCP_ISSUER_URL when it overrides the app URL", async () => {
    vi.stubEnv("MCP_ISSUER_URL", "https://mcp.hellosugar.salon")
    const body = await (await authServerGet()).json()
    expect(body.issuer).toBe("https://mcp.hellosugar.salon")
    expect(body.token_endpoint).toBe("https://mcp.hellosugar.salon/mcp/token")
  })
})

describe("protected resource metadata (RFC 9728)", () => {
  const expected = {
    resource: `${ISSUER}/api/mcp`,
    authorization_servers: [ISSUER],
    scopes_supported: ["marketplace:read", "marketplace:write"],
    bearer_methods_supported: ["header"],
  }

  it("names the exact MCP endpoint as the resource", async () => {
    expect(await (await prGet()).json()).toEqual(expected)
  })

  it("serves the identical document at the path-suffixed URL Claude probes first", async () => {
    expect(await (await prSuffixedGet()).json()).toEqual(expected)
  })

  it("sets CORS on both variants", async () => {
    for (const res of [await prGet(), await prSuffixedGet()]) {
      expect(res.headers.get("access-control-allow-origin")).toBe("*")
      expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS")
      expect(res.headers.get("access-control-allow-headers")).toBe("*")
    }
  })

  it("answers the CORS preflight on both variants", async () => {
    expect((await prOptions()).status).toBe(204)
    expect((await prSuffixedOptions()).status).toBe(204)
  })
})
