import { describe, it, expect } from "vitest"
import { computeOwnedListingIds, ownedBqNameSet } from "@/lib/owner-map/ownership"

describe("ownedBqNameSet", () => {
  it("collects non-null resolved names and drops nulls", () => {
    const set = ownedBqNameSet([
      { resolvedBqLocationName: "Sugar House" },
      { resolvedBqLocationName: null },
      { resolvedBqLocationName: "Draper" },
    ])
    expect(set).toEqual(new Set(["Sugar House", "Draper"]))
  })
})

describe("computeOwnedListingIds", () => {
  const owned = new Set(["Sugar House"])

  it("matches a listing the user is selling", () => {
    const rows = [
      { listingId: "l1", sellerId: "u1", bqLocationName: null, dataMappingStatus: null },
    ]
    expect(computeOwnedListingIds(rows, "u1", new Set())).toEqual(["l1"])
  })

  it("matches a listing whose confirmed location bq name is owned", () => {
    const rows = [
      { listingId: "l1", sellerId: "other", bqLocationName: "Sugar House", dataMappingStatus: "confirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", owned)).toEqual(["l1"])
  })

  it("ignores unconfirmed mappings even when the bq name is owned", () => {
    const rows = [
      { listingId: "l1", sellerId: "other", bqLocationName: "Sugar House", dataMappingStatus: "unconfirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", owned)).toEqual([])
  })

  it("ignores null bq names and non-owned names", () => {
    const rows = [
      { listingId: "l1", sellerId: "other", bqLocationName: null, dataMappingStatus: "confirmed" },
      { listingId: "l2", sellerId: "other", bqLocationName: "Elsewhere", dataMappingStatus: "confirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", owned)).toEqual([])
  })

  it("returns a bundle listing once even when several of its locations match", () => {
    const rows = [
      { listingId: "l1", sellerId: "u1", bqLocationName: "Sugar House", dataMappingStatus: "confirmed" },
      { listingId: "l1", sellerId: "u1", bqLocationName: "Draper", dataMappingStatus: "confirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", owned)).toEqual(["l1"])
  })

  it("returns [] for a user with no ownership signals", () => {
    const rows = [
      { listingId: "l1", sellerId: "other", bqLocationName: "Sugar House", dataMappingStatus: "confirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", new Set())).toEqual([])
  })
})
