import { describe, it, expect, vi } from "vitest"
import {
  decideAccess,
  normalizeSignInEmail,
  allowlistCandidates,
  type AccessGateDeps,
} from "@/lib/auth/access-gate"

const deps = (isAllowlisted: (c: string[]) => Promise<boolean>): AccessGateDeps => ({
  workspaceDomain: "hellosugar.salon",
  isAllowlisted: vi.fn(isAllowlisted),
})

/** True when any candidate is in the given set — what the real db query does. */
const stored = (...entries: string[]) => async (candidates: string[]) =>
  candidates.some((c) => entries.includes(c))

describe("normalizeSignInEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeSignInEmail("  Mixed.Case@Example.COM \n")).toBe("mixed.case@example.com")
  })

  it("leaves an already-normal address untouched", () => {
    expect(normalizeSignInEmail("a@b.com")).toBe("a@b.com")
  })
})

describe("allowlistCandidates", () => {
  it("offers the address and its exact domain entry", () => {
    expect(allowlistCandidates("jane@partner.com")).toEqual([
      "jane@partner.com",
      "@partner.com",
    ])
  })

  it("never widens a subdomain address to its parent domain", () => {
    expect(allowlistCandidates("jane@mail.partner.com")).toEqual([
      "jane@mail.partner.com",
      "@mail.partner.com",
    ])
  })

  it("omits the domain candidate when there is no domain", () => {
    expect(allowlistCandidates("nodomain")).toEqual(["nodomain"])
  })
})

describe("decideAccess", () => {
  it("matches the workspace domain case-insensitively", async () => {
    const d = deps(async () => false)
    expect(await decideAccess("Franchisee@HelloSugar.Salon", d)).toBe("workspace")
  })

  it("never consults the allowlist for a workspace address", async () => {
    const d = deps(async () => false)
    expect(await decideAccess("franchisee@hellosugar.salon", d)).toBe("workspace")
    expect(d.isAllowlisted).not.toHaveBeenCalled()
  })

  it("does not treat a lookalike domain as workspace", async () => {
    const d = deps(async () => false)
    // The suffix test includes the "@" boundary, so this must fall through.
    expect(await decideAccess("user@nothellosugar.salon", d)).toBe("denied")
    expect(d.isAllowlisted).toHaveBeenCalledWith([
      "user@nothellosugar.salon",
      "@nothellosugar.salon",
    ])
  })

  it("asks for exactly the address and its domain entry, in one call", async () => {
    const d = deps(async () => false)
    await decideAccess("  Jane@Partner.com ", d)
    expect(d.isAllowlisted).toHaveBeenCalledTimes(1)
    expect(d.isAllowlisted).toHaveBeenCalledWith(["jane@partner.com", "@partner.com"])
  })

  it("allows an external address on the allowlist, looked up normalized", async () => {
    const d = deps(stored("partner@external.com"))
    expect(await decideAccess("  Partner@External.com ", d)).toBe("allowlisted")
    expect(d.isAllowlisted).toHaveBeenCalledWith([
      "partner@external.com",
      "@external.com",
    ])
  })

  it("allows any address on an allowlisted domain", async () => {
    const d = deps(stored("@partner.com"))
    expect(await decideAccess("Jane@Partner.com", d)).toBe("allowlisted")
    expect(await decideAccess("someone.else@partner.com", d)).toBe("allowlisted")
  })

  it("does NOT let an allowlisted domain admit its subdomains", async () => {
    const d = deps(stored("@partner.com"))
    expect(await decideAccess("jane@mail.partner.com", d)).toBe("denied")
    // The only domain candidate offered is the exact one.
    expect(d.isAllowlisted).toHaveBeenCalledWith([
      "jane@mail.partner.com",
      "@mail.partner.com",
    ])
  })

  it("admits a subdomain only when it is allowlisted in its own right", async () => {
    const d = deps(stored("@mail.partner.com"))
    expect(await decideAccess("jane@mail.partner.com", d)).toBe("allowlisted")
    expect(await decideAccess("jane@partner.com", d)).toBe("denied")
  })

  it("denies when neither the domain nor the allowlist matches", async () => {
    const d = deps(async () => false)
    expect(await decideAccess("stranger@gmail.com", d)).toBe("denied")
  })

  it("respects a custom workspace domain", async () => {
    const d: AccessGateDeps = {
      workspaceDomain: "customdomain.com",
      isAllowlisted: vi.fn(async () => false),
    }
    expect(await decideAccess("user@customdomain.com", d)).toBe("workspace")
    expect(await decideAccess("user@hellosugar.salon", d)).toBe("denied")
  })
})
