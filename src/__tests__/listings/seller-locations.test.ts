import { describe, it, expect, vi, beforeEach } from "vitest"
import type { OwnerLocation } from "@/db/schema"

vi.mock("server-only", () => ({}))

const getMyOwnerLocations = vi.fn()
vi.mock("@/lib/owner-directory/data", () => ({ getMyOwnerLocations }))

const getNetSalesByLocation = vi.fn()
const getMcrByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({ getNetSalesByLocation, getMcrByLocation }))

/** Minimal owner-directory row; only the fields the mapper reads are set. */
function ownerLoc(over: Partial<OwnerLocation>): OwnerLocation {
  return {
    id: "ol-1",
    ownerIdentifier: "owner-1",
    ownerName: null,
    ownerContactEmail: null,
    blvdLocationName: "Sugar House",
    blvdLocationNumber: null,
    locationAddress: null,
    actualSuiteGoDate: null,
    suiteClosedDate: null,
    actualFlagshipGoDate: null,
    flagshipClosedDate: null,
    ownerContactEmailNormalized: null,
    resolvedBqLocationName: null,
    blvdMatchMethod: "unmatched",
    blvdMatchConfidence: "none",
    syncedAt: new Date(),
    ...over,
  }
}

describe("getSellerLocations", () => {
  beforeEach(() => {
    vi.resetModules()
    getMyOwnerLocations.mockReset()
    getNetSalesByLocation.mockReset()
    getMcrByLocation.mockReset()
    getNetSalesByLocation.mockResolvedValue(new Map())
    getMcrByLocation.mockResolvedValue(new Map())
  })

  it("populates ttmRevenue (cents) and mcr (fraction) from BigQuery, matched on resolvedBqLocationName", async () => {
    getMyOwnerLocations.mockResolvedValue({
      locations: [ownerLoc({ id: "a", blvdLocationName: "Sugar House", resolvedBqLocationName: "Sugar House" })],
    })
    getNetSalesByLocation.mockResolvedValue(
      new Map([["Sugar House", { totalCents: 42_500_000, trend: [] }]]),
    )
    // BigQuery returns MCR as a percentage (e.g. 34.5), not a fraction.
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))

    const { getSellerLocations } = await import("@/lib/listings/seller-locations")
    const [loc] = await getSellerLocations()

    expect(loc.ttmRevenue).toBe(42_500_000) // cents, straight from totalCents
    expect(loc.mcr).toBeCloseTo(0.345) // percentage converted to fraction for the wizard
  })

  it("leaves ttmRevenue/mcr undefined when the location has no resolved BigQuery name", async () => {
    getMyOwnerLocations.mockResolvedValue({
      locations: [ownerLoc({ id: "a", resolvedBqLocationName: null })],
    })
    getNetSalesByLocation.mockResolvedValue(new Map([["Sugar House", { totalCents: 1, trend: [] }]]))
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))

    const { getSellerLocations } = await import("@/lib/listings/seller-locations")
    const [loc] = await getSellerLocations()

    expect(loc.ttmRevenue).toBeUndefined()
    expect(loc.mcr).toBeUndefined()
  })

  it("leaves ttmRevenue/mcr undefined when the resolved name is absent from the BigQuery maps", async () => {
    getMyOwnerLocations.mockResolvedValue({
      locations: [ownerLoc({ id: "a", resolvedBqLocationName: "Unmapped Location" })],
    })

    const { getSellerLocations } = await import("@/lib/listings/seller-locations")
    const [loc] = await getSellerLocations()

    expect(loc.ttmRevenue).toBeUndefined()
    expect(loc.mcr).toBeUndefined()
  })

  it("still carries the base directory fields through", async () => {
    getMyOwnerLocations.mockResolvedValue({
      locations: [
        ownerLoc({
          id: "a",
          blvdLocationName: "Sugar House",
          blvdLocationNumber: "1234",
          locationAddress: "123 Main St",
          resolvedBqLocationName: "Sugar House",
        }),
      ],
    })

    const { getSellerLocations } = await import("@/lib/listings/seller-locations")
    const [loc] = await getSellerLocations()

    expect(loc.id).toBe("a")
    expect(loc.name).toBe("Sugar House")
    expect(loc.externalId).toBe("1234")
    expect(loc.address).toBe("123 Main St")
    expect(loc.type).toBe("salon")
  })
})
