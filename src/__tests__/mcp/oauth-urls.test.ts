import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  issuerUrl,
  mcpResourceUrl,
  protectedResourceMetadataUrl,
} from "@/lib/mcp/oauth/urls"

/**
 * env.X is a live view of process.env under the test runner (see the Proxy at
 * the bottom of src/lib/env.ts), so vi.stubEnv in beforeEach is visible to the
 * module under test even though it was imported at file load.
 */
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://marketplace.hellosugar.salon")
  vi.stubEnv("MCP_ISSUER_URL", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("issuerUrl", () => {
  it("falls back to NEXT_PUBLIC_APP_URL when MCP_ISSUER_URL is unset", () => {
    expect(issuerUrl()).toBe("https://marketplace.hellosugar.salon")
  })

  it("prefers MCP_ISSUER_URL when it is set", () => {
    vi.stubEnv("MCP_ISSUER_URL", "https://mcp.hellosugar.salon")
    expect(issuerUrl()).toBe("https://mcp.hellosugar.salon")
  })

  it("strips trailing slashes so concatenated paths never double up", () => {
    vi.stubEnv("MCP_ISSUER_URL", "https://mcp.hellosugar.salon///")
    expect(issuerUrl()).toBe("https://mcp.hellosugar.salon")
  })

  it("throws when neither var is set, rather than emitting 'undefined/api/mcp'", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "")
    expect(() => issuerUrl()).toThrow(/MCP_ISSUER_URL/)
  })
})

describe("derived URLs", () => {
  it("builds the RFC 8707 resource identifier for the MCP endpoint", () => {
    expect(mcpResourceUrl()).toBe("https://marketplace.hellosugar.salon/api/mcp")
  })

  it("builds the path-suffixed protected-resource metadata URL Claude probes first", () => {
    expect(protectedResourceMetadataUrl()).toBe(
      "https://marketplace.hellosugar.salon/.well-known/oauth-protected-resource/api/mcp",
    )
  })

  it("derives both from the issuer override, not from the app URL", () => {
    vi.stubEnv("MCP_ISSUER_URL", "https://mcp.hellosugar.salon/")
    expect(mcpResourceUrl()).toBe("https://mcp.hellosugar.salon/api/mcp")
    expect(protectedResourceMetadataUrl()).toBe(
      "https://mcp.hellosugar.salon/.well-known/oauth-protected-resource/api/mcp",
    )
  })
})
