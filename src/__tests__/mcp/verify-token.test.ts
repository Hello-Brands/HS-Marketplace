import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }))

vi.mock("@/db", () => ({
  db: {
    select: (...args: unknown[]) => select(...args),
    update: (...args: unknown[]) => update(...args),
  },
}))

vi.mock("@/lib/mcp/oauth/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/oauth/tokens")>()
  return { ...actual, sha256Hex: vi.fn(actual.sha256Hex) }
})

import {
  verifyMcpToken,
  parseBearer,
  bearerChallenge,
  insufficientScopeChallenge,
  MCP_SCOPES,
} from "@/lib/mcp/auth/verify-token"
import { sha256Hex } from "@/lib/mcp/oauth/tokens"

const ISSUER = "https://marketplace.hellosugar.salon"
const TOKEN = "an-access-token"

const future = (ms: number) => new Date(Date.now() + ms)
const past = (ms: number) => new Date(Date.now() - ms)

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "tok-1",
  clientId: "claude-hosted",
  userId: "admin-1",
  scope: "marketplace:read marketplace:write",
  expiresAt: future(3_600_000),
  revokedAt: null,
  lastUsedAt: null,
  email: "parker@hellosugar.salon",
  role: "admin",
  ...overrides,
})

let updateBuilder: ChainedBuilder

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ISSUER)
  vi.stubEnv("MCP_ISSUER_URL", "")
  select.mockReturnValue(builder([row()]))
  updateBuilder = builder(undefined)
  update.mockReturnValue(updateBuilder)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parseBearer", () => {
  it("extracts the token from a Bearer header", () => {
    expect(parseBearer("Bearer abc123")).toBe("abc123")
  })

  it("is case-insensitive about the scheme and tolerant of extra spaces", () => {
    expect(parseBearer("bearer   abc123  ")).toBe("abc123")
  })

  it("returns null for a missing, empty or non-Bearer header", () => {
    expect(parseBearer(null)).toBeNull()
    expect(parseBearer(undefined)).toBeNull()
    expect(parseBearer("")).toBeNull()
    expect(parseBearer("Basic abc123")).toBeNull()
    expect(parseBearer("Bearer")).toBeNull()
    expect(parseBearer("Bearer   ")).toBeNull()
  })
})

describe("verifyMcpToken — acceptance", () => {
  it("returns the actor for a live token owned by an admin", async () => {
    const actor = await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(actor).toEqual({
      userId: "admin-1",
      email: "parker@hellosugar.salon",
      scopes: ["marketplace:read", "marketplace:write"],
      clientId: "claude-hosted",
      tokenId: "tok-1",
    })
  })

  it("splits a read-only scope into a one-element list", async () => {
    select.mockReturnValue(builder([row({ scope: "marketplace:read" })]))
    const actor = await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(actor?.scopes).toEqual(["marketplace:read"])
  })

  it("tolerates a null email on the user row", async () => {
    select.mockReturnValue(builder([row({ email: null })]))
    expect((await verifyMcpToken(`Bearer ${TOKEN}`))?.email).toBeNull()
  })

  it("looks the token up by its SHA-256 hash, never in the clear", async () => {
    await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(sha256Hex).toHaveBeenCalledWith(TOKEN)
  })
})

describe("verifyMcpToken — rejection", () => {
  it("returns null with no header at all, without querying", async () => {
    expect(await verifyMcpToken(null)).toBeNull()
    expect(select).not.toHaveBeenCalled()
  })

  it("returns null for a non-Bearer scheme, without querying", async () => {
    expect(await verifyMcpToken("Basic abc")).toBeNull()
    expect(select).not.toHaveBeenCalled()
  })

  it("returns null when no row matches", async () => {
    select.mockReturnValue(builder([]))
    expect(await verifyMcpToken(`Bearer ${TOKEN}`)).toBeNull()
  })

  it("returns null for a revoked grant", async () => {
    select.mockReturnValue(builder([row({ revokedAt: past(1000) })]))
    expect(await verifyMcpToken(`Bearer ${TOKEN}`)).toBeNull()
  })

  it("returns null for an expired access token", async () => {
    select.mockReturnValue(builder([row({ expiresAt: past(1000) })]))
    expect(await verifyMcpToken(`Bearer ${TOKEN}`)).toBeNull()
  })

  it("returns null when the owner is no longer an admin", async () => {
    // Demotion revokes MCP access on the NEXT call, not at token expiry.
    select.mockReturnValue(builder([row({ role: "user" })]))
    expect(await verifyMcpToken(`Bearer ${TOKEN}`)).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })
})

describe("verifyMcpToken — last_used_at touch", () => {
  it("stamps last_used_at when it has never been set", async () => {
    await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({ lastUsedAt: expect.any(Date) })
  })

  it("stamps it again once the value is older than 60 s", async () => {
    select.mockReturnValue(builder([row({ lastUsedAt: past(61_000) })]))
    await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("does NOT write when it was touched within the last 60 s", async () => {
    // Otherwise every MCP call becomes a write.
    select.mockReturnValue(builder([row({ lastUsedAt: past(5_000) })]))
    await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(update).not.toHaveBeenCalled()
  })

  it("still returns the actor when the touch write fails", async () => {
    update.mockImplementation(() => {
      throw new Error("connection reset")
    })
    const actor = await verifyMcpToken(`Bearer ${TOKEN}`)
    expect(actor?.userId).toBe("admin-1")
  })
})

describe("WWW-Authenticate challenges", () => {
  it("points a 401 at the protected-resource metadata document", () => {
    expect(bearerChallenge()).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/api/mcp", scope="marketplace:read"`,
    )
  })

  it("names the scope that was actually required", () => {
    expect(bearerChallenge("marketplace:write")).toContain('scope="marketplace:write"')
  })

  it("marks a 403 as insufficient_scope", () => {
    expect(insufficientScopeChallenge("marketplace:write")).toBe(
      `Bearer error="insufficient_scope", scope="marketplace:write", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/api/mcp"`,
    )
  })

  it("re-exports the scope vocabulary so PR C has one import site", () => {
    expect(MCP_SCOPES).toEqual(["marketplace:read", "marketplace:write"])
  })
})
