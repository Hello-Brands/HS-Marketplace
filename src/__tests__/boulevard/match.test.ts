import { describe, it, expect } from "vitest"
import { normalizeName, suggestBoulevardMatch } from "@/lib/boulevard/match"

const BLVD = [
  { id: "b1", name: "Hello Sugar — Atlanta Buckhead" },
  { id: "b2", name: "Hello Sugar Atlanta Midtown" },
  { id: "b3", name: "Hello Sugar Boise Downtown" },
]

describe("normalizeName", () => {
  it("lowercases, strips punctuation and the brand prefix, collapses whitespace", () => {
    expect(normalizeName("Hello Sugar — Atlanta  Buckhead!")).toBe("atlanta buckhead")
  })
})

describe("suggestBoulevardMatch", () => {
  it("matches the same location across punctuation/casing differences", () => {
    const m = suggestBoulevardMatch("Hello Sugar Atlanta Buckhead", BLVD)
    expect(m?.id).toBe("b1")
    expect(m!.confidence).toBeGreaterThanOrEqual(0.9)
  })
  it("returns null when nothing is close", () => {
    expect(suggestBoulevardMatch("Hello Sugar Dallas Uptown", BLVD)).toBeNull()
  })
})
