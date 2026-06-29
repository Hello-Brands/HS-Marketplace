import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { fetchLocationReviews } from "@/lib/kpi/fetch"

describe("fetchLocationReviews gating", () => {
  it("returns null when bqLocationName is null", async () => {
    const result = await fetchLocationReviews({
      listingStatus: "active",
      mappingStatus: "confirmed",
      bqLocationName: null,
    })
    expect(result).toBeNull()
  })

  it("returns null when the listing is not active", async () => {
    const result = await fetchLocationReviews({
      listingStatus: "draft",
      mappingStatus: "confirmed",
      bqLocationName: "AZ Peoria | Park West 007",
    })
    expect(result).toBeNull()
  })

  it("returns null when the mapping is not confirmed", async () => {
    const result = await fetchLocationReviews({
      listingStatus: "active",
      mappingStatus: "unconfirmed",
      bqLocationName: "AZ Peoria | Park West 007",
    })
    expect(result).toBeNull()
  })
})
