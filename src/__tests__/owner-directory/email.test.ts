import { describe, it, expect } from "vitest"
import { normalizeEmail } from "@/lib/owner-directory/email"

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Shane.Koehn@HelloSugar.Salon ")).toBe(
      "shane.koehn@hellosugar.salon"
    )
  })

  it("returns null for null/undefined", () => {
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
  })

  it("returns null for empty/whitespace-only", () => {
    expect(normalizeEmail("")).toBeNull()
    expect(normalizeEmail("   ")).toBeNull()
  })
})
