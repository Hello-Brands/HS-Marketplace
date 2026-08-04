import { describe, it, expect, vi, beforeEach } from "vitest"

const insert = vi.fn()
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    insert: (...a: unknown[]) => insert(...a),
  },
}))
vi.mock("@/lib/competitor-query", () => ({
  getCompetitorClosures: vi.fn(async () => []),
}))

import { getCompetitorClosures } from "@/lib/competitor-query"
import { seedCompetitorLedger } from "@/lib/competitor-alert-log"
import { OWNER_AUTO_ORIGIN } from "@/lib/owner-alerts/constants"

const scope = { centerLat: 40.2, centerLng: -111.6, radiusMiles: 3, states: [] }

const closure = (googlePlaceId: string, businessStatus: string) =>
  ({
    googlePlaceId,
    brandId: "b",
    brandName: "Brand",
    address: "1 Main",
    city: "Provo",
    state: "UT",
    latitude: 40.2,
    longitude: -111.6,
    businessStatus,
    closedAt: null,
    nearestHsName: null,
    nearestHsMiles: null,
    isOpportunity: true,
    mapsUrl: null,
  })

/** The place IDs handed to the ledger insert across all calls. */
function seededPlaceIds(values: ReturnType<typeof vi.fn>): string[] {
  return values.mock.calls.flatMap((call) =>
    (call[0] as { googlePlaceId: string }[]).map((r) => r.googlePlaceId)
  )
}

describe("seedCompetitorLedger", () => {
  let values: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    values = vi.fn(() => ({ onConflictDoNothing: async () => undefined }))
    insert.mockReturnValue({ values })
    vi.mocked(getCompetitorClosures).mockResolvedValue([
      closure("perm-1", "CLOSED_PERMANENTLY"),
      closure("temp-1", "CLOSED_TEMPORARILY"),
    ])
  })

  it("seeds both closure types for a user saved search", async () => {
    await seedCompetitorLedger("alert-user", scope)
    expect(seededPlaceIds(values)).toEqual(["perm-1", "temp-1"])
  })

  it("seeds permanent closures only for an owner-auto alert", async () => {
    // The cron filters owner-auto alerts to permanent-only, so a
    // CLOSED_TEMPORARILY competitor seeded at opt-in would be silently
    // suppressed forever once it flips to CLOSED_PERMANENTLY.
    await seedCompetitorLedger("alert-owner", scope, { origin: OWNER_AUTO_ORIGIN })
    expect(seededPlaceIds(values)).toEqual(["perm-1"])
  })

  it("no-ops on an unbounded scope", async () => {
    await seedCompetitorLedger("alert-x", { centerLat: null, centerLng: null, radiusMiles: null, states: [] })
    expect(insert).not.toHaveBeenCalled()
  })
})
