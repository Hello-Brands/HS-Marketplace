import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
// The route reaches the real verify-token and server modules for their challenge
// helpers and WRITE_TOOL_NAMES, and those pull `@/db` in transitively — which opens a
// Neon connection at import time. No query runs in this file; the route never touches
// the DB once `verifyMcpToken` is stubbed.
vi.mock("@/db", () => ({ db: {} }))
// Same reason: the owner-directory query module reaches NextAuth, which does not
// resolve under vitest's ESM loader. Nothing in this file calls it.
vi.mock("@/auth", () => ({ auth: vi.fn() }))

const { verifyMcpToken, protectedResourceMetadataUrl, fetchImpl, closeImpl, createMcpRequestHandler } =
  vi.hoisted(() => {
    const fetchImpl = vi.fn()
    const closeImpl = vi.fn()
    return {
      verifyMcpToken: vi.fn(),
      protectedResourceMetadataUrl: vi.fn(),
      fetchImpl,
      closeImpl,
      createMcpRequestHandler: vi.fn(() => ({ fetch: fetchImpl, close: closeImpl })),
    }
  })

vi.mock("@/lib/mcp/oauth/urls", () => ({ protectedResourceMetadataUrl }))
// Only `verifyMcpToken` is stubbed: `bearerChallenge` and `insufficientScopeChallenge`
// are the real PR B helpers, so the header assertions below check the strings the
// endpoint actually emits rather than a copy of them kept in this file.
vi.mock("@/lib/mcp/auth/verify-token", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/auth/verify-token")>(
    "@/lib/mcp/auth/verify-token",
  )
  return { ...actual, verifyMcpToken }
})
vi.mock("@/lib/mcp/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mcp/server")>("@/lib/mcp/server")
  return { createMcpRequestHandler, WRITE_TOOL_NAMES: actual.WRITE_TOOL_NAMES }
})

import { POST, GET, DELETE } from "@/app/api/mcp/route"

const METADATA_URL = "https://marketplace.hellosugar.salon/.well-known/oauth-protected-resource/api/mcp"

const ADMIN = {
  userId: "u-1",
  email: "admin@hellosugar.salon",
  scopes: ["marketplace:read", "marketplace:write"],
  clientId: "claude-code",
  tokenId: "tok-1",
}

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://marketplace.hellosugar.salon/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

const AUTHED = { authorization: "Bearer good-token" }

beforeEach(() => {
  verifyMcpToken.mockReset().mockResolvedValue(ADMIN)
  protectedResourceMetadataUrl.mockReset().mockReturnValue(METADATA_URL)
  fetchImpl.mockReset().mockResolvedValue(new Response('{"ok":true}', { status: 200 }))
  closeImpl.mockReset().mockResolvedValue(undefined)
  createMcpRequestHandler.mockClear()
})

describe("unauthenticated requests", () => {
  it("answers 401 with the RFC 9728 resource_metadata challenge", async () => {
    verifyMcpToken.mockResolvedValue(null)
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
    expect(res.status).toBe(401)
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${METADATA_URL}", scope="marketplace:read marketplace:write"`,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(createMcpRequestHandler).not.toHaveBeenCalled()
  })

  it("issues the same challenge when the Authorization header is missing entirely", async () => {
    verifyMcpToken.mockResolvedValue(null)
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {}))
    expect(res.status).toBe(401)
    expect(verifyMcpToken).toHaveBeenCalledWith(null)
  })

  it("passes the raw Authorization header to the verifier", async () => {
    await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTHED))
    expect(verifyMcpToken).toHaveBeenCalledWith("Bearer good-token")
  })

  it("never caches an auth failure", async () => {
    verifyMcpToken.mockResolvedValue(null)
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }))
    expect(res.headers.get("cache-control")).toBe("no-store")
  })
})

describe("scope enforcement", () => {
  it("rejects a token without marketplace:read as insufficient_scope", async () => {
    verifyMcpToken.mockResolvedValue({ ...ADMIN, scopes: [] })
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTHED))
    expect(res.status).toBe(403)
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer error="insufficient_scope", scope="marketplace:read", resource_metadata="${METADATA_URL}"`,
    )
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a write tools/call from a read-only token with 403, not a missing-tool error", async () => {
    verifyMcpToken.mockResolvedValue({ ...ADMIN, scopes: ["marketplace:read"] })
    const res = await POST(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reject_listing", arguments: {} } },
        AUTHED,
      ),
    )
    expect(res.status).toBe(403)
    expect(res.headers.get("www-authenticate")).toBe(
      `Bearer error="insufficient_scope", scope="marketplace:write", resource_metadata="${METADATA_URL}"`,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(createMcpRequestHandler).not.toHaveBeenCalled()
  })

  it("lets a READ tools/call through on a read-only token", async () => {
    verifyMcpToken.mockResolvedValue({ ...ADMIN, scopes: ["marketplace:read"] })
    const res = await POST(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_listings", arguments: {} } },
        AUTHED,
      ),
    )
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("lets a write tools/call through on a read+write token", async () => {
    const res = await POST(
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "reject_listing", arguments: {} } },
        AUTHED,
      ),
    )
    expect(res.status).toBe(200)
  })

  it("ignores a params-less or non-tools/call body when checking write scope", async () => {
    verifyMcpToken.mockResolvedValue({ ...ADMIN, scopes: ["marketplace:read"] })
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/call" }, AUTHED))
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe("dispatch", () => {
  it("builds the handler for the verified actor and hands it the parsed body", async () => {
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" }
    await POST(rpc(body, AUTHED))
    expect(createMcpRequestHandler).toHaveBeenCalledWith(ADMIN)
    expect(fetchImpl.mock.calls[0][1]).toEqual({ parsedBody: body })
  })

  it("returns the handler's response untouched", async () => {
    fetchImpl.mockResolvedValue(new Response('{"jsonrpc":"2.0"}', { status: 202 }))
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTHED))
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('{"jsonrpc":"2.0"}')
  })

  it("closes the per-request handler once the response is in hand", async () => {
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTHED))
    expect(closeImpl).toHaveBeenCalledTimes(1)
    // The body must survive the teardown — close() aborts only in-flight exchanges.
    expect(await res.text()).toBe('{"ok":true}')
  })

  it("closes the handler even when the SDK throws", async () => {
    fetchImpl.mockRejectedValue(new Error("boom"))
    await expect(POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, AUTHED))).rejects.toThrow("boom")
    expect(closeImpl).toHaveBeenCalledTimes(1)
  })

  it("answers a malformed JSON body with a JSON-RPC parse error, not a 500", async () => {
    const res = await POST(
      new Request("https://marketplace.hellosugar.salon/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTHED },
        body: "{ not json",
      }),
    )
    expect(res.status).toBe(400)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(createMcpRequestHandler).not.toHaveBeenCalled()
  })
})

describe("non-POST methods", () => {
  it("answers GET with 405 and an Allow header", async () => {
    const res = await GET()
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
    expect(res.headers.get("cache-control")).toBe("no-store")
  })

  it("answers DELETE with 405 and an Allow header", async () => {
    const res = await DELETE()
    expect(res.status).toBe(405)
    expect(res.headers.get("allow")).toBe("POST")
  })
})
