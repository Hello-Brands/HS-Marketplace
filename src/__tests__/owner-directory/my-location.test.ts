import { describe, it, expect, vi, beforeEach } from "vitest"
import type { OwnerLocation } from "@/db/schema"

vi.mock("server-only", () => ({}))

const getMyOwnerLocations = vi.fn()
vi.mock("@/lib/owner-directory/data", () => ({ getMyOwnerLocations }))

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
    latitude: null,
    longitude: null,
    geocodedAt: null,
    ...over,
  }
}

describe("getMyOwnerLocationById", () => {
  beforeEach(() => {
    vi.resetModules()
    getMyOwnerLocations.mockReset()
  })

  it("returns the row when the signed-in owner owns it", async () => {
    getMyOwnerLocations.mockResolvedValue({
      ownerIdentifier: "owner-1",
      locations: [ownerLoc({ id: "a" }), ownerLoc({ id: "b" })],
    })
    const { getMyOwnerLocationById } = await import("@/lib/owner-directory/my-location")
    const row = await getMyOwnerLocationById("b")
    expect(row?.id).toBe("b")
  })

  it("returns null for an id outside the owner's scoped rows (someone else's location)", async () => {
    getMyOwnerLocations.mockResolvedValue({
      ownerIdentifier: "owner-1",
      locations: [ownerLoc({ id: "a" })],
    })
    const { getMyOwnerLocationById } = await import("@/lib/owner-directory/my-location")
    expect(await getMyOwnerLocationById("not-mine")).toBeNull()
  })

  it("returns null for an unlinked user (no owned rows)", async () => {
    getMyOwnerLocations.mockResolvedValue({ ownerIdentifier: null, locations: [] })
    const { getMyOwnerLocationById } = await import("@/lib/owner-directory/my-location")
    expect(await getMyOwnerLocationById("a")).toBeNull()
  })
})
