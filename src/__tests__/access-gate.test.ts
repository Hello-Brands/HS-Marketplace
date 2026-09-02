import { describe, it, expect, vi } from "vitest"
import {
  decideAccess,
  normalizeSignInEmail,
  type AccessGateDeps,
} from "@/lib/auth/access-gate"

const deps = (isAllowlisted: (e: string) => Promise<boolean>): AccessGateDeps => ({
  workspaceDomain: "hellosugar.salon",
  isAllowlisted: vi.fn(isAllowlisted),
})

describe("normalizeSignInEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeSignInEmail("  Mixed.Case@Example.COM \n")).toBe("mixed.case@example.com")
  })

  it("leaves an already-normal address untouched", () => {
    expect(normalizeSignInEmail("a@b.com")).toBe("a@b.com")
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
    expect(d.isAllowlisted).toHaveBeenCalledWith("user@nothellosugar.salon")
  })

  it("allows an external address on the allowlist, looked up normalized", async () => {
    const d = deps(async (e) => e === "partner@external.com")
    expect(await decideAccess("  Partner@External.com ", d)).toBe("allowlisted")
    expect(d.isAllowlisted).toHaveBeenCalledWith("partner@external.com")
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
