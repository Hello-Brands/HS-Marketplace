import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Tests the REAL NextAuth callbacks/events defined in src/auth.ts.
 *
 * next-auth is mocked so that the `NextAuth(config)` call in src/auth.ts
 * captures the production config object (callbacks + events); tests then
 * invoke those captured functions directly. If the guards in src/auth.ts are
 * removed or inverted, these tests fail.
 */

const { captured, mockAllowlistFindFirst, mockUpdate, updateSetCalls, getEffectiveOwnerIdentifiers } = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = []
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    captured: { config: null as any },
    mockAllowlistFindFirst: vi.fn(),
    mockUpdate: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    updateSetCalls,
    getEffectiveOwnerIdentifiers: vi.fn(),
  }
})

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }
  },
}))
vi.mock("@auth/drizzle-adapter", () => ({ DrizzleAdapter: vi.fn(() => ({})) }))
vi.mock("@/lib/owner-directory/login", () => ({
  linkOwnerAtLogin: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/owner-directory/links", () => ({
  getEffectiveOwnerIdentifiers,
  getUserOwnerLinks: vi.fn(),
}))
vi.mock("@/lib/analytics/logins", () => ({
  recordLogin: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/db", () => ({
  db: {
    query: { allowlist: { findFirst: mockAllowlistFindFirst } },
    update: mockUpdate,
  },
}))

// Importing src/auth.ts executes NextAuth(...) with the production callbacks,
// which the next-auth mock above captures.
import "@/auth"
import { __resetRateLimits } from "@/lib/rate-limit"
import { MAGIC_LINK_MAX_AGE_SECONDS } from "@/lib/auth/magic-link-email"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const signInCallback = (args: any): Promise<boolean | string> =>
  captured.config.callbacks.signIn(args)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionCallback = (args: any): Promise<any> => captured.config.callbacks.session(args)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createUserEvent = (args: any): Promise<void> => captured.config.events.createUser(args)

/**
 * Pull the bound string literals out of a drizzle `where` clause.
 *
 * `eq(allowlist.email, x)` returns an opaque SQL object whose `queryChunks`
 * hold the column (which back-references its PgTable, so JSON.stringify blows
 * up on the cycle) alongside a Param carrying the value. This walks it
 * cycle-safely so a test can assert on the value actually sent to the db.
 */
function boundStrings(input: unknown): string[] {
  const out: string[] = []
  const seen = new WeakSet<object>()
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      out.push(node)
      return
    }
    if (typeof node !== "object" || node === null) return
    if (seen.has(node)) return
    seen.add(node)
    for (const value of Object.values(node)) walk(value)
  }
  walk(input)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
  __resetRateLimits()
  vi.stubEnv("GOOGLE_WORKSPACE_DOMAIN", "hellosugar.salon")
  vi.stubEnv("INITIAL_ADMIN_EMAIL", "")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("auth signIn callback (real src/auth.ts)", () => {
  it("captured the production config", () => {
    expect(captured.config).toBeTruthy()
    expect(typeof captured.config.callbacks.signIn).toBe("function")
  })

  it("rejects unknown providers", async () => {
    const result = await signInCallback({
      account: { provider: "credentials" },
      profile: { email: "franchisee@hellosugar.salon", email_verified: true },
    })
    expect(result).toBe(false)
    expect(mockAllowlistFindFirst).not.toHaveBeenCalled()
  })

  it("rejects unverified google emails", async () => {
    const result = await signInCallback({
      account: { provider: "google" },
      profile: { email: "franchisee@hellosugar.salon", email_verified: false },
    })
    expect(result).toBe(false)
  })

  it("allows workspace-domain emails without consulting the allowlist", async () => {
    const result = await signInCallback({
      account: { provider: "google" },
      profile: { email: "franchisee@hellosugar.salon", email_verified: true },
    })
    expect(result).toBe(true)
    expect(mockAllowlistFindFirst).not.toHaveBeenCalled()
  })

  it("allows external emails found on the allowlist", async () => {
    mockAllowlistFindFirst.mockResolvedValue({ id: "1", email: "partner@external.com" })
    const result = await signInCallback({
      account: { provider: "google" },
      profile: { email: "partner@external.com", email_verified: true },
    })
    expect(result).toBe(true)
    expect(mockAllowlistFindFirst).toHaveBeenCalledTimes(1)
  })

  it("redirects non-allowlisted external emails to /access-denied", async () => {
    mockAllowlistFindFirst.mockResolvedValue(undefined)
    const result = await signInCallback({
      account: { provider: "google" },
      profile: { email: "stranger@gmail.com", email_verified: true },
    })
    expect(result).toBe("/access-denied")
  })

  it("respects a custom GOOGLE_WORKSPACE_DOMAIN", async () => {
    vi.stubEnv("GOOGLE_WORKSPACE_DOMAIN", "customdomain.com")
    mockAllowlistFindFirst.mockResolvedValue(undefined)

    const custom = await signInCallback({
      account: { provider: "google" },
      profile: { email: "user@customdomain.com", email_verified: true },
    })
    expect(custom).toBe(true)

    // The default domain is no longer privileged and falls through to the allowlist.
    const oldDefault = await signInCallback({
      account: { provider: "google" },
      profile: { email: "user@hellosugar.salon", email_verified: true },
    })
    expect(oldDefault).toBe("/access-denied")
  })

  it("does not treat a lookalike domain suffix without @ as workspace", async () => {
    mockAllowlistFindFirst.mockResolvedValue(undefined)
    const result = await signInCallback({
      account: { provider: "google" },
      profile: { email: "attacker@evilhellosugar.salon", email_verified: true },
    })
    expect(result).toBe("/access-denied")
  })

  // Latent bug the shared gate fixes: the allowlist column is written lowercase
  // by the admin action, so a mixed-case Google profile email used to miss.
  it("looks up the allowlist with the lowercased google email", async () => {
    mockAllowlistFindFirst.mockResolvedValue({ id: "1", email: "mixed.case@example.com" })
    const result = await signInCallback({
      account: { provider: "google" },
      profile: { email: "Mixed.Case@Example.com", email_verified: true },
    })
    expect(result).toBe(true)
    expect(mockAllowlistFindFirst).toHaveBeenCalledTimes(1)
    // The drizzle `inArray(...)` object is opaque, so assert the bound values
    // show up in its serialized form rather than reaching into its internals.
    // Both candidates are bound: the address and its exact "@domain" entry.
    const bound = boundStrings(mockAllowlistFindFirst.mock.calls[0][0])
    expect(bound).toContain("mixed.case@example.com")
    expect(bound).toContain("@example.com")
    expect(bound).not.toContain("Mixed.Case@Example.com")
  })

  // A whole-company allowlist entry is stored in the same column with a
  // leading "@", so the gate offers it as a second candidate in the same
  // query. The mock can't tell which candidate matched, so the meaningful
  // assertion is that "@partner.com" was among the bound strings.
  it("offers the exact @domain entry as an allowlist candidate", async () => {
    mockAllowlistFindFirst.mockResolvedValue({ id: "1", email: "@partner.com" })
    const result = await signInCallback({
      account: { provider: "google" },
      profile: { email: "jane@partner.com", email_verified: true },
    })
    expect(result).toBe(true)
    expect(mockAllowlistFindFirst).toHaveBeenCalledTimes(1)
    const bound = boundStrings(mockAllowlistFindFirst.mock.calls[0][0])
    expect(bound).toContain("jane@partner.com")
    expect(bound).toContain("@partner.com")
  })

  // Exact-domain matching: a subdomain address never asks for the parent
  // domain, so an admin's "@partner.com" grant cannot leak to it.
  it("never offers the parent domain for a subdomain address", async () => {
    mockAllowlistFindFirst.mockResolvedValue(undefined)
    const result = await signInCallback({
      account: { provider: "google" },
      profile: { email: "jane@mail.partner.com", email_verified: true },
    })
    expect(result).toBe("/access-denied")
    const bound = boundStrings(mockAllowlistFindFirst.mock.calls[0][0])
    expect(bound).toContain("@mail.partner.com")
    expect(bound).not.toContain("@partner.com")
  })
})

describe("auth signIn callback — resend magic link (real src/auth.ts)", () => {
  // Auth.js passes `email: { verificationRequest: true }` on the pre-send pass
  // and omits `email` entirely when the recipient clicks the link.
  const verificationRequest = (address: string) =>
    signInCallback({
      user: { email: address },
      account: { provider: "resend" },
      email: { verificationRequest: true },
    })

  it("allows an allowlisted address and looks it up lowercased", async () => {
    mockAllowlistFindFirst.mockResolvedValue({ id: "1", email: "partner@external.com" })
    const result = await verificationRequest("Partner@External.com")
    expect(result).toBe(true)
    expect(mockAllowlistFindFirst).toHaveBeenCalledTimes(1)
    expect(boundStrings(mockAllowlistFindFirst.mock.calls[0][0])).toContain(
      "partner@external.com",
    )
  })

  it("allows a workspace-domain address without consulting the allowlist", async () => {
    const result = await verificationRequest("franchisee@hellosugar.salon")
    expect(result).toBe(true)
    expect(mockAllowlistFindFirst).not.toHaveBeenCalled()
  })

  // A returned string short-circuits Auth.js into a redirect BEFORE
  // sendVerificationRequest runs (@auth/core send-token.js), so a stranger who
  // types an address into /login never receives a link.
  it("redirects a non-allowlisted address to /access-denied instead of mailing a link", async () => {
    mockAllowlistFindFirst.mockResolvedValue(undefined)
    const result = await verificationRequest("stranger@gmail.com")
    expect(result).toBe("/access-denied")
  })

  it("rejects a resend sign-in with no email on the user", async () => {
    const result = await signInCallback({
      user: {},
      account: { provider: "resend" },
      email: { verificationRequest: true },
    })
    expect(result).toBe(false)
    expect(mockAllowlistFindFirst).not.toHaveBeenCalled()
  })

  it("allows the link-click phase (no `email` prop) for an allowlisted address", async () => {
    mockAllowlistFindFirst.mockResolvedValue({ id: "1", email: "partner@external.com" })
    const result = await signInCallback({
      user: { email: "partner@external.com" },
      account: { provider: "resend" },
    })
    expect(result).toBe(true)
  })

  it("rate limits link requests to 3 per address, then pretends it sent", async () => {
    mockAllowlistFindFirst.mockResolvedValue({ id: "1", email: "partner@external.com" })

    for (let i = 0; i < 3; i++) {
      expect(await verificationRequest("partner@external.com")).toBe(true)
    }
    // 4th request inside the window: same page, no extra email, no enumeration.
    expect(await verificationRequest("partner@external.com")).toBe("/check-email")

    // A different address has its own window.
    expect(await verificationRequest("other@external.com")).toBe(true)
  })

  it("keys the rate limit on the normalized address", async () => {
    mockAllowlistFindFirst.mockResolvedValue({ id: "1", email: "partner@external.com" })
    for (let i = 0; i < 3; i++) await verificationRequest("Partner@External.com")
    // Same mailbox, different casing — must hit the same bucket.
    expect(await verificationRequest("partner@external.com")).toBe("/check-email")
  })

  it("uses a 15-minute magic-link window", () => {
    expect(MAGIC_LINK_MAX_AGE_SECONDS).toBe(900)
  })
})

describe("auth session callback (real src/auth.ts)", () => {
  it("propagates id, role, sellerAccess, and ownerIdentifiers onto the session user", async () => {
    getEffectiveOwnerIdentifiers.mockResolvedValue(["ut-lines-towns", "ut-towns"])
    const session = { user: { name: "Jane", email: "jane@hellosugar.salon" } }
    const result = await sessionCallback({
      session,
      user: { id: "user-1", role: "admin", sellerAccess: true },
    })
    expect(result.user.id).toBe("user-1")
    expect(result.user.role).toBe("admin")
    expect(result.user.sellerAccess).toBe(true)
    expect(result.user.ownerIdentifiers).toEqual(["ut-lines-towns", "ut-towns"])
    expect(getEffectiveOwnerIdentifiers).toHaveBeenCalledWith("user-1")
  })

  it("gives an unlinked user an empty array, not null", async () => {
    getEffectiveOwnerIdentifiers.mockResolvedValue([])
    const result = await sessionCallback({
      session: { user: {} },
      user: { id: "user-2", role: "user", sellerAccess: false },
    })
    expect(result.user.ownerIdentifiers).toEqual([])
    expect(result.user.sellerAccess).toBe(false)
  })

  it("falls back to an empty array when the link lookup fails (never breaks the session)", async () => {
    getEffectiveOwnerIdentifiers.mockRejectedValue(new Error("neon exploded"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await sessionCallback({
      session: { user: {} },
      user: { id: "user-3", role: "user", sellerAccess: false },
    })
    expect(result.user.ownerIdentifiers).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("auth createUser event (real src/auth.ts)", () => {
  it("bootstraps the first admin when email matches INITIAL_ADMIN_EMAIL", async () => {
    vi.stubEnv("INITIAL_ADMIN_EMAIL", "boss@external.com")
    await createUserEvent({ user: { id: "u1", email: "boss@external.com" } })
    expect(updateSetCalls).toContainEqual({ role: "admin" })
  })

  it("does not bootstrap admin for a non-matching email", async () => {
    vi.stubEnv("INITIAL_ADMIN_EMAIL", "boss@external.com")
    await createUserEvent({ user: { id: "u2", email: "someone-else@external.com" } })
    expect(updateSetCalls).not.toContainEqual({ role: "admin" })
  })

  it("auto-grants sellerAccess to workspace-domain users", async () => {
    await createUserEvent({ user: { id: "u3", email: "franchisee@hellosugar.salon" } })
    expect(updateSetCalls).toContainEqual({ sellerAccess: true })
  })

  it("does not grant sellerAccess to external users", async () => {
    await createUserEvent({ user: { id: "u4", email: "partner@gmail.com" } })
    expect(updateSetCalls).toHaveLength(0)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("applies both admin bootstrap and sellerAccess when the initial admin is a franchisee", async () => {
    vi.stubEnv("INITIAL_ADMIN_EMAIL", "founder@hellosugar.salon")
    await createUserEvent({ user: { id: "u5", email: "founder@hellosugar.salon" } })
    expect(updateSetCalls).toContainEqual({ role: "admin" })
    expect(updateSetCalls).toContainEqual({ sellerAccess: true })
  })
})
