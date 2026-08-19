import { describe, it, expect } from "vitest"
import {
  formatBrandChipLabel,
  monitoredCountLabel,
  sortMonitoredBrands,
} from "@/lib/brand-requests/monitored-brands-display"

describe("formatBrandChipLabel", () => {
  it("shows just the name when the count has never been scraped (null)", () => {
    expect(formatBrandChipLabel("Radiant Waxing", null)).toBe("Radiant Waxing")
  })

  it("shows just the name when the count is 0", () => {
    // "0 locations" reads as a broken scrape, not as information.
    expect(formatBrandChipLabel("Radiant Waxing", 0)).toBe("Radiant Waxing")
  })

  it("uses the singular for exactly one location", () => {
    expect(formatBrandChipLabel("Radiant Waxing", 1)).toBe(
      "Radiant Waxing · 1 location",
    )
  })

  it("uses the plural for many locations", () => {
    expect(formatBrandChipLabel("Radiant Waxing", 39)).toBe(
      "Radiant Waxing · 39 locations",
    )
  })

  it("treats a nonsense negative count like a missing one", () => {
    expect(formatBrandChipLabel("Radiant Waxing", -3)).toBe("Radiant Waxing")
  })

  it("trims surrounding whitespace in the name", () => {
    expect(formatBrandChipLabel("  European Wax Center  ", 2)).toBe(
      "European Wax Center · 2 locations",
    )
  })
})

describe("sortMonitoredBrands", () => {
  it("sorts alphabetically, ignoring case", () => {
    const brands = [
      { name: "zap waxing" },
      { name: "Amazing Lash" },
      { name: "benefit" },
      { name: "Bare Wax" },
    ]
    expect(sortMonitoredBrands(brands).map((b) => b.name)).toEqual([
      "Amazing Lash",
      "Bare Wax",
      "benefit",
      "zap waxing",
    ])
  })

  it("does not mutate the input array", () => {
    const brands = [{ name: "Zap" }, { name: "Amy" }]
    const snapshot = [...brands]
    sortMonitoredBrands(brands)
    expect(brands).toEqual(snapshot)
  })

  it("returns a new array", () => {
    const brands = [{ name: "Amy" }]
    expect(sortMonitoredBrands(brands)).not.toBe(brands)
  })

  it("preserves the other fields on each row", () => {
    const brands = [
      { brandId: "z", name: "Zap", locationsCount: null },
      { brandId: "a", name: "Amy", locationsCount: 4 },
    ]
    expect(sortMonitoredBrands(brands)).toEqual([
      { brandId: "a", name: "Amy", locationsCount: 4 },
      { brandId: "z", name: "Zap", locationsCount: null },
    ])
  })

  it("handles empty and single-element input", () => {
    expect(sortMonitoredBrands([])).toEqual([])
    expect(sortMonitoredBrands([{ name: "Solo" }])).toEqual([{ name: "Solo" }])
  })
})

describe("monitoredCountLabel", () => {
  it("uses the singular for one brand", () => {
    expect(monitoredCountLabel(1)).toBe("1 brand")
  })

  it("uses the plural for many brands", () => {
    expect(monitoredCountLabel(25)).toBe("25 brands")
  })

  it("uses the plural for zero brands", () => {
    expect(monitoredCountLabel(0)).toBe("0 brands")
  })
})
