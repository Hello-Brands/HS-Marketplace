import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"
import { __resetRateLimits } from "@/lib/rate-limit"

/**
 * Tests the REAL POST handler in src/app/mcp/token/route.ts. Only the DB is
 * mocked; the rate limiter is the production module, reset between tests.
 */

const { findClient, findCode, findToken, findUser, batch, update, insert } = vi.hoisted(() => ({
  findClient: vi.fn(),
  findCode: vi.fn(),
  findToken: vi.fn(),
  findUser: vi.fn(),
  batch: vi.fn().mockResolvedValue(undefined),
  update: vi.fn(),
  insert: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    query: {
      mcpOauthClients: { findFirst: findClient },
      mcpOauthCodes: { findFirst: findCode },
      mcpOauthTokens: { findFirst: findToken },
      users: { findFirst: findUser },
    },
    batch: (...args: unknown[]) => batch(...args),
    update: (...args: unknown[]) => update(...args),
    insert: (...args: unknown[]) => insert(...args),
  },
}))

import { POST } from "@/app/mcp/token/route"

const ISSUER = "https://marketplace.hellosugar.salon"
const RESOURCE = `${ISSUER}/api/mcp`
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
const CHALLENGE = createHash("sha256").update(VERIFIER, "ascii").digest("base64url")

const CLIENT = { clientId: "claude-hosted", name: "Claude", redirectUris: [], isPublic: true }

const future = (ms: number) => new Date(Date.now() + ms)
const past = (ms: number) => new Date(Date.now() - ms)

const codeRow = (overrides: Record<string, unknown> = {}) => ({
  codeHash: sha256("the-code"),
  clientId: "claude-hosted",
  userId: "admin-1",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  codeChallenge: CHALLENGE,
  scope: "marketplace:read marketplace:write",
  resource: RESOURCE,
  label: "Parker's laptop",
  expiresAt: future(60_000),
  usedAt: null,
  createdAt: new Date(),
  ...overrides,
})

const tokenRow = (overrides: Record<string, unknown> = {}) => ({
  id: "tok-1",
  tokenHash: sha256("old-access"),
  refreshTokenHash: sha256("the-refresh"),
  clientId: "claude-hosted",
  userId: "admin-1",
  scope: "marketplace:read marketplace:write",
  label: null,
  expiresAt: past(1000),
  refreshExpiresAt: future(86_400_000),
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
})

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function post(
  body: Record<string, string>,
  init: { contentType?: string | null; ip?: string } = {},
): Request {
  const headers: Record<string, string> = {}
  const contentType =
    init.contentType === undefined ? "application/x-www-form-urlencoded" : init.contentType
  if (contentType !== null) headers["content-type"] = contentType
  headers["x-forwarded-for"] = init.ip ?? "203.0.113.7"
  return new Request("http://localhost/mcp/token", {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  })
}

const codeGrant = (overrides: Record<string, string> = {}) => ({
  grant_type: "authorization_code",
  client_id: "claude-hosted",
  code: "the-code",
  redirect_uri: "https://claude.ai/api/mcp/auth_callback",
  code_verifier: VERIFIER,
  resource: RESOURCE,
  ...overrides,
})

let updateBuilder: ChainedBuilder
let insertBuilder: ChainedBuilder

beforeEach(() => {
  vi.clearAllMocks()
  __resetRateLimits()
  findClient.mockResolvedValue(CLIENT)
  findCode.mockResolvedValue(codeRow())
  findToken.mockResolvedValue(tokenRow())
  findUser.mockResolvedValue({ role: "admin" })
  updateBuilder = builder(undefined)
  insertBuilder = builder(undefined)
  update.mockReturnValue(updateBuilder)
  insert.mockReturnValue(insertBuilder)
  batch.mockResolvedValue(undefined)
})

describe("content type and method gate", () => {
  it("rejects a JSON body with 415", async () => {
    const res = await POST(post(codeGrant(), { contentType: "application/json" }))
    expect(res.status).toBe(415)
    expect((await res.json()).error).toBe("invalid_request")
    expect(batch).not.toHaveBeenCalled()
  })

  it("rejects a missing content type with 415", async () => {
    const res = await POST(post(codeGrant(), { contentType: null }))
    expect(res.status).toBe(415)
  })

  it("accepts a charset parameter on the form content type", async () => {
    const res = await POST(
      post(codeGrant(), { contentType: "application/x-www-form-urlencoded; charset=UTF-8" }),
    )
    expect(res.status).toBe(200)
  })
})

describe("authorization_code grant", () => {
  it("returns the token pair and marks the code used in one batch", async () => {
    const res = await POST(post(codeGrant()))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")

    const body = await res.json()
    expect(body.token_type).toBe("Bearer")
    expect(body.expires_in).toBe(3600)
    expect(body.scope).toBe("marketplace:read marketplace:write")
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.access_token).not.toBe(body.refresh_token)

    // One atomic batch: neon-http has no transactions, and a half-applied
    // exchange would leave a replayable code.
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls[0][0]).toHaveLength(2)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({ usedAt: expect.any(Date) })
  })

  it("stores only hashes of the issued tokens, and copies scope, label and owner", async () => {
    const body = await (await POST(post(codeGrant()))).json()
    const row = insertBuilder.calls.values[0][0] as Record<string, unknown>
    expect(row.tokenHash).toBe(sha256(body.access_token))
    expect(row.refreshTokenHash).toBe(sha256(body.refresh_token))
    expect(row).toMatchObject({
      clientId: "claude-hosted",
      userId: "admin-1",
      scope: "marketplace:read marketplace:write",
      label: "Parker's laptop",
    })
    expect(JSON.stringify(row)).not.toContain(body.access_token)
    expect(JSON.stringify(row)).not.toContain(body.refresh_token)
  })

  it("sets a 1-hour access expiry and a 30-day refresh expiry", async () => {
    const before = Date.now()
    await POST(post(codeGrant()))
    const row = insertBuilder.calls.values[0][0] as Record<string, Date>
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(3_600_000 - 50)
    expect(row.refreshExpiresAt.getTime() - before).toBeGreaterThanOrEqual(
      30 * 24 * 3_600_000 - 50,
    )
  })

  it("carries a read-only grant through unchanged", async () => {
    findCode.mockResolvedValue(codeRow({ scope: "marketplace:read" }))
    const body = await (await POST(post(codeGrant()))).json()
    expect(body.scope).toBe("marketplace:read")
  })

  const rejections: Array<[string, () => void, Record<string, string>]> = [
    ["an unknown code", () => findCode.mockResolvedValue(undefined), {}],
    ["an already-used code", () => findCode.mockResolvedValue(codeRow({ usedAt: past(1000) })), {}],
    ["an expired code", () => findCode.mockResolvedValue(codeRow({ expiresAt: past(1000) })), {}],
    ["a code issued to another client", () => findCode.mockResolvedValue(codeRow({ clientId: "claude-code" })), {}],
    ["a mismatched redirect_uri", () => {}, { redirect_uri: "https://claude.ai/other" }],
    ["a mismatched resource", () => {}, { resource: `${ISSUER}/api/other` }],
    ["a wrong PKCE verifier", () => {}, { code_verifier: "not-the-verifier" }],
  ]

  it.each(rejections)("rejects %s with invalid_grant and writes nothing", async (_label, arrange, overrides) => {
    arrange()
    const res = await POST(post(codeGrant(overrides)))
    expect(res.status).toBe(400)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect((await res.json()).error).toBe("invalid_grant")
    expect(batch).not.toHaveBeenCalled()
  })

  it("rejects a missing code_verifier with invalid_request", async () => {
    const fields = codeGrant()
    delete (fields as Record<string, string>).code_verifier
    const res = await POST(post(fields))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_request")
    expect(batch).not.toHaveBeenCalled()
  })

  it("never leaks the code or the verifier in an error body", async () => {
    findCode.mockResolvedValue(undefined)
    const text = await (await POST(post(codeGrant()))).text()
    expect(text).not.toContain("the-code")
    expect(text).not.toContain(VERIFIER)
  })
})

describe("refresh_token grant", () => {
  const refreshGrant = (overrides: Record<string, string> = {}) => ({
    grant_type: "refresh_token",
    client_id: "claude-hosted",
    refresh_token: "the-refresh",
    ...overrides,
  })

  it("rotates BOTH hashes and extends both expiries", async () => {
    const res = await POST(post(refreshGrant()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // The presented refresh token must NOT come back — rotation means the old
    // one is dead the moment this returns.
    expect(body.refresh_token).not.toBe("the-refresh")

    const set = updateBuilder.calls.set[0][0] as Record<string, unknown>
    expect(set.tokenHash).toBe(sha256(body.access_token))
    expect(set.refreshTokenHash).toBe(sha256(body.refresh_token))
    expect(set.expiresAt).toBeInstanceOf(Date)
    expect(set.refreshExpiresAt).toBeInstanceOf(Date)
  })

  it("returns the grant's existing scope", async () => {
    findToken.mockResolvedValue(tokenRow({ scope: "marketplace:read" }))
    const body = await (await POST(post(refreshGrant()))).json()
    expect(body.scope).toBe("marketplace:read")
  })

  it("re-checks that the user is still an admin, and refuses when they are not", async () => {
    // Demotion must kill the connection at the next refresh, not at expiry.
    findUser.mockResolvedValue({ role: "user" })
    const res = await POST(post(refreshGrant()))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_grant")
    expect(update).not.toHaveBeenCalled()
  })

  it("refuses when the user row is gone", async () => {
    findUser.mockResolvedValue(undefined)
    expect((await (await POST(post(refreshGrant()))).json()).error).toBe("invalid_grant")
    expect(update).not.toHaveBeenCalled()
  })

  it.each([
    ["an unknown refresh token", () => findToken.mockResolvedValue(undefined)],
    ["a revoked grant", () => findToken.mockResolvedValue(tokenRow({ revokedAt: past(1000) }))],
    ["an expired refresh token", () => findToken.mockResolvedValue(tokenRow({ refreshExpiresAt: past(1000) }))],
    ["a grant belonging to another client", () => findToken.mockResolvedValue(tokenRow({ clientId: "claude-code" }))],
  ])("rejects %s with invalid_grant", async (_label, arrange) => {
    arrange()
    const res = await POST(post(refreshGrant()))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_grant")
    expect(update).not.toHaveBeenCalled()
  })

  it("rejects a missing refresh_token with invalid_request", async () => {
    const res = await POST(post({ grant_type: "refresh_token", client_id: "claude-hosted" }))
    expect((await res.json()).error).toBe("invalid_request")
  })
})

describe("client and grant-type gate", () => {
  it("rejects a missing client_id with invalid_client", async () => {
    const fields = codeGrant()
    delete (fields as Record<string, string>).client_id
    const res = await POST(post(fields))
    expect((await res.json()).error).toBe("invalid_client")
    expect(batch).not.toHaveBeenCalled()
  })

  it("rejects an unregistered client with invalid_client", async () => {
    findClient.mockResolvedValue(undefined)
    const res = await POST(post(codeGrant()))
    expect((await res.json()).error).toBe("invalid_client")
    expect(batch).not.toHaveBeenCalled()
  })

  it("rejects an unsupported grant type", async () => {
    const res = await POST(post({ grant_type: "client_credentials", client_id: "claude-hosted" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("unsupported_grant_type")
  })

  it("rejects a missing grant type", async () => {
    const res = await POST(post({ client_id: "claude-hosted" }))
    expect((await res.json()).error).toBe("unsupported_grant_type")
  })
})

describe("per-IP rate limit", () => {
  it("blocks the 21st request in a minute from one IP with 429 and Retry-After", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await POST(post(codeGrant(), { ip: "198.51.100.4" }))
      expect(res.status).toBe(200)
    }
    const blocked = await POST(post(codeGrant(), { ip: "198.51.100.4" }))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("cache-control")).toBe("no-store")
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(0)
  })

  it("keys the limit on the FIRST x-forwarded-for hop, not the whole header", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(post(codeGrant(), { ip: "198.51.100.5, 10.0.0.1" }))
    }
    // Same client IP, different proxy chain — must still be blocked.
    const blocked = await POST(post(codeGrant(), { ip: "198.51.100.5, 10.0.0.2" }))
    expect(blocked.status).toBe(429)
  })

  it("does not let one IP exhaust another IP's budget", async () => {
    for (let i = 0; i < 20; i++) {
      await POST(post(codeGrant(), { ip: "198.51.100.6" }))
    }
    const other = await POST(post(codeGrant(), { ip: "198.51.100.7" }))
    expect(other.status).toBe(200)
  })
})
