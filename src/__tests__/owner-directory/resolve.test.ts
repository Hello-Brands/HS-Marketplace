import { describe, it, expect } from "vitest"
import { resolveBlvdLocationName } from "@/lib/owner-directory/resolve"

// Mirrors the real data: directory blvd_location_name == BigQuery LOCATION_NAME.
const BQ_NAMES = [
  "AL Auburn | Midtown 255",
  "CA Los Angeles | Santa Monica 170 (Offboarded)",
  "NC Charlotte | Matthews (old) (Offboarded)",
]

describe("resolveBlvdLocationName", () => {
  it("name_exact / high when the normalized names are identical (case + punctuation differ)", () => {
    const r = resolveBlvdLocationName("al auburn - midtown 255", BQ_NAMES)
    expect(r.method).toBe("name_exact")
    expect(r.confidence).toBe("high")
    expect(r.resolvedBqLocationName).toBe("AL Auburn | Midtown 255")
  })

  it("name_fuzzy / medium for a strong (>=0.75) partial match — e.g. an (Offboarded) suffix", () => {
    const r = resolveBlvdLocationName("CA Los Angeles | Santa Monica 170", BQ_NAMES)
    expect(r.method).toBe("name_fuzzy")
    expect(r.confidence).toBe("medium")
    expect(r.resolvedBqLocationName).toBe("CA Los Angeles | Santa Monica 170 (Offboarded)")
  })

  it("name_fuzzy / low for a weaker match just above the floor", () => {
    const r = resolveBlvdLocationName("NC Charlotte | Matthews 034", BQ_NAMES)
    expect(r.method).toBe("name_fuzzy")
    expect(r.confidence).toBe("low")
  })

  it("unmatched / none when nothing clears the threshold", () => {
    const r = resolveBlvdLocationName("WA Seattle | Capitol Hill 900", BQ_NAMES)
    expect(r).toEqual({ resolvedBqLocationName: null, method: "unmatched", confidence: "none" })
  })

  it("unmatched when the candidate list is empty (BigQuery list unavailable)", () => {
    expect(resolveBlvdLocationName("AL Auburn | Midtown 255", [])).toEqual({
      resolvedBqLocationName: null,
      method: "unmatched",
      confidence: "none",
    })
  })

  it("never matches on the location number alone (number_exact is not used)", () => {
    // Shares only the trailing number with the candidate -> below threshold.
    const r = resolveBlvdLocationName("XX Nowhere | Void 255", ["AL Auburn | Midtown 255"])
    expect(r.method).toBe("unmatched")
  })
})
