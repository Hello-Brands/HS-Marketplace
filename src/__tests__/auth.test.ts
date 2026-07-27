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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const signInCallback = (args: any): Promise<boolean | string> =>
  captured.config.callbacks.signIn(args)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionCallback = (args: any): Promise<any> => captured.config.callbacks.session(args)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createUserEvent = (args: any): Promise<void> => captured.config.events.createUser(args)

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
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

  it("rejects non-google providers", async () => {
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
