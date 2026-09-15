import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHash } from "node:crypto"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

/**
 * Tests the REAL `approveMcpConsent` server action.
 *
 * `redirect()` is mocked to THROW a tagged error, which is what the real
 * next/navigation redirect does (it throws NEXT_REDIRECT); that is how each
 * test reads the destination URL and how it proves the action stopped there.
 */

const { redirectMock, requireAdmin, findFirst, insert } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const err = new Error("NEXT_REDIRECT") as Error & { redirectUrl: string }
    err.redirectUrl = url
    throw err
  }),
  requireAdmin: vi.fn(),
  findFirst: vi.fn(),
  insert: vi.fn(),
}))

vi.mock("next/navigation", () => ({ redirect: redirectMock }))
vi.mock("@/lib/auth-guards", () => ({ requireAdmin }))
vi.mock("@/db", () => ({
  db: {
    query: { mcpOauthClients: { findFirst } },
    insert: (...args: unknown[]) => insert(...args),
  },
}))

import { approveMcpConsent } from "@/app/mcp/authorize/actions"

const ISSUER = "https://marketplace.hellosugar.salon"
const RESOURCE = `${ISSUER}/api/mcp`
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
const CHALLENGE = createHash("sha256").update(VERIFIER, "ascii").digest("base64url")

const CLIENT = {
  clientId: "claude-hosted",
  name: "Claude (claude.ai)",
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  isPublic: true,
  createdAt: new Date("2026-09-14T00:00:00.000Z"),
}

let insertBuilder: ChainedBuilder

function form(overrides: Record<string, string> = {}): FormData {
  const fields: Record<string, string> = {
    client_id: "claude-hosted",
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    scope: "marketplace:read marketplace:write",
    resource: RESOURCE,
    state: "xyz-state",
    scope_choice: "read_write",
    decision: "approve",
    ...overrides,
  }
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== "") fd.set(key, value)
  }
  return fd
}

/** Run the action and return the URL its redirect() was handed. */
async function capture(fd: FormData): Promise<string> {
  try {
    await approveMcpConsent(fd)
  } catch (err) {
    const tagged = err as Error & { redirectUrl?: string }
    if (tagged.redirectUrl) return tagged.redirectUrl
    throw err
  }
  throw new Error("approveMcpConsent returned without redirecting")
}

/** The single row handed to db.insert(...).values(...). */
function insertedRow(): Record<string, unknown> {
  return insertBuilder.calls.values[0][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ISSUER)
  vi.stubEnv("MCP_ISSUER_URL", "")
  requireAdmin.mockResolvedValue({
    id: "admin-1",
    email: "parker@hellosugar.salon",
    role: "admin",
  })
  findFirst.mockResolvedValue(CLIENT)
  insertBuilder = builder(undefined)
  insert.mockReturnValue(insertBuilder)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("approveMcpConsent — approval", () => {
  it("redirects to the client with code, state and iss", async () => {
    const url = new URL(await capture(form()))
    expect(url.origin + url.pathname).toBe("https://claude.ai/api/mcp/auth_callback")
    expect(url.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get("state")).toBe("xyz-state")
    expect(url.searchParams.get("iss")).toBe(ISSUER)
    expect(url.searchParams.has("error")).toBe(false)
  })

  it("stores only the SHA-256 hash of the code, never the code itself", async () => {
    const url = new URL(await capture(form()))
    const code = url.searchParams.get("code")!
    const row = insertedRow()
    expect(row.codeHash).toBe(createHash("sha256").update(code, "utf8").digest("hex"))
    expect(JSON.stringify(row)).not.toContain(code)
  })

  it("records the client, admin, redirect_uri, challenge and resource", async () => {
    await capture(form())
    expect(insertedRow()).toMatchObject({
      clientId: "claude-hosted",
      userId: "admin-1",
      redirectUri: "https://claude.ai/api/mcp/auth_callback",
      codeChallenge: CHALLENGE,
      resource: RESOURCE,
    })
  })

  it("expires the code five minutes out", async () => {
    const before = Date.now()
    await capture(form())
    const expiresAt = insertedRow().expiresAt as Date
    expect(expiresAt).toBeInstanceOf(Date)
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50)
    expect(expiresAt.getTime() - before).toBeLessThanOrEqual(5 * 60 * 1000 + 5000)
  })

  it("grants both scopes for the read-and-write choice", async () => {
    await capture(form({ scope_choice: "read_write" }))
    expect(insertedRow().scope).toBe("marketplace:read marketplace:write")
  })

  it("grants only read for the read-only choice", async () => {
    await capture(form({ scope_choice: "read" }))
    expect(insertedRow().scope).toBe("marketplace:read")
  })

  it("never grants write when the client did not request it", async () => {
    // A tampered scope_choice must not widen the grant past the request.
    await capture(form({ scope: "marketplace:read", scope_choice: "read_write" }))
    expect(insertedRow().scope).toBe("marketplace:read")
  })

  it("stores a trimmed label", async () => {
    await capture(form({ label: "  Parker's laptop  " }))
    expect(insertedRow().label).toBe("Parker's laptop")
  })

  it("truncates a label past 60 characters", async () => {
    await capture(form({ label: "x".repeat(200) }))
    expect(insertedRow().label).toBe("x".repeat(60))
  })

  it("stores null for an omitted or whitespace-only label", async () => {
    await capture(form())
    expect(insertedRow().label).toBeNull()
    insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)
    await capture(form({ label: "   " }))
    expect(insertedRow().label).toBeNull()
  })

  it("omits state from the redirect when the request carried none", async () => {
    const fd = form()
    fd.delete("state")
    const url = new URL(await capture(fd))
    expect(url.searchParams.has("state")).toBe(false)
    expect(url.searchParams.get("code")).toBeTruthy()
  })
})

describe("approveMcpConsent — denial", () => {
  it("redirects with error=access_denied and writes nothing", async () => {
    const url = new URL(await capture(form({ decision: "deny" })))
    expect(url.searchParams.get("error")).toBe("access_denied")
    expect(url.searchParams.get("state")).toBe("xyz-state")
    expect(url.searchParams.get("iss")).toBe(ISSUER)
    expect(url.searchParams.has("code")).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })

  it("treats an absent decision as a denial (fail closed)", async () => {
    const fd = form()
    fd.delete("decision")
    const url = new URL(await capture(fd))
    expect(url.searchParams.get("error")).toBe("access_denied")
    expect(insert).not.toHaveBeenCalled()
  })
})

describe("approveMcpConsent — rejection", () => {
  it("refuses a non-admin caller and writes nothing", async () => {
    requireAdmin.mockRejectedValue(new Error("Unauthorized: Admin access required"))
    await expect(approveMcpConsent(form())).rejects.toThrow("Unauthorized")
    expect(insert).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("throws rather than redirecting when the client is unknown", async () => {
    // An unverified redirect_uri must never receive a redirect.
    findFirst.mockResolvedValue(undefined)
    await expect(approveMcpConsent(form({ client_id: "ghost" }))).rejects.toThrow(
      /Unknown client_id/,
    )
    expect(insert).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("throws rather than redirecting when redirect_uri is not registered", async () => {
    await expect(
      approveMcpConsent(form({ redirect_uri: "https://evil.example/steal" })),
    ).rejects.toThrow(/redirect_uri is not registered/)
    expect(insert).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("redirects with invalid_request when the PKCE method was tampered to plain", async () => {
    const url = new URL(await capture(form({ code_challenge_method: "plain" })))
    expect(url.searchParams.get("error")).toBe("invalid_request")
    expect(insert).not.toHaveBeenCalled()
  })

  it("redirects with invalid_request when the resource does not match", async () => {
    const url = new URL(await capture(form({ resource: `${ISSUER}/api/other` })))
    expect(url.searchParams.get("error")).toBe("invalid_request")
    expect(insert).not.toHaveBeenCalled()
  })
})
