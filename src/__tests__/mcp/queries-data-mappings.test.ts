import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const { findMany, listLocationNames, suggestLocationMatch, unresolvedSalonLocations } = vi.hoisted(
  () => ({
    findMany: vi.fn(),
    listLocationNames: vi.fn(),
    suggestLocationMatch: vi.fn(),
    unresolvedSalonLocations: vi.fn(),
  }),
)

vi.mock("@/db", () => ({ db: { query: { listingLocations: { findMany } } } }))
vi.mock("@/lib/bigquery/queries", () => ({ listLocationNames }))
vi.mock("@/lib/data/match", () => ({ suggestLocationMatch }))
vi.mock("@/lib/data/mapping", () => ({ unresolvedSalonLocations }))

import { unresolvedMappings } from "@/lib/mcp/queries/data-mappings"

/** One row as `db.query.listingLocations.findMany` returns it, listing relation included. */
function locationRow(over: Record<string, unknown> = {}) {
  return {
    id: "loc-1",
    name: "Hello Sugar Austin South",
    locationType: "salon",
    dataMappingStatus: "unconfirmed",
    bqLocationName: null,
    listing: { id: "l-1", title: "Austin South", status: "pending" },
    ...over,
  }
}

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([locationRow()])
  listLocationNames.mockReset().mockResolvedValue(["Austin South", "Denver Highlands"])
  suggestLocationMatch
    .mockReset()
    .mockReturnValue({ id: "Austin South", name: "Austin South", confidence: 0.86 })
  // The blocking filter is the real module's job; here it simply passes everything
  // through so these tests exercise the projection, not drizzle or the filter.
  unresolvedSalonLocations.mockReset().mockImplementation((rows: { id: string }[]) => rows)
})

describe("unresolvedMappings with BigQuery configured", () => {
  it("reports bq_configured and carries the suggested BigQuery name", async () => {
    const result = await unresolvedMappings()
    expect(result.bq_configured).toBe(true)
    expect(result.items[0].suggestion).toEqual({
      bq_location_name: "Austin South",
      confidence: 0.86,
    })
    // Scored against the location's own name and the BigQuery names as candidates.
    expect(suggestLocationMatch).toHaveBeenCalledWith("Hello Sugar Austin South", [
      { id: "Austin South", name: "Austin South" },
      { id: "Denver Highlands", name: "Denver Highlands" },
    ])
  })

  it("leaves suggestion null when nothing scores highly enough", async () => {
    suggestLocationMatch.mockReturnValue(null)
    const result = await unresolvedMappings()
    expect(result.bq_configured).toBe(true)
    expect(result.items[0].suggestion).toBeNull()
  })

  it("projects the listing, mapping status and current mapping onto UnresolvedMapping", async () => {
    findMany.mockResolvedValue([locationRow({ bqLocationName: "Austin (old)" })])
    const result = await unresolvedMappings()
    expect(result.items[0]).toEqual({
      location_id: "loc-1",
      location_name: "Hello Sugar Austin South",
      listing: { id: "l-1", title: "Austin South", status: "pending" },
      status: "unconfirmed",
      current_bq_location_name: "Austin (old)",
      suggestion: { bq_location_name: "Austin South", confidence: 0.86 },
    })
  })

  it("reports a location with no listing as listing: null", async () => {
    findMany.mockResolvedValue([locationRow({ listing: null })])
    const result = await unresolvedMappings()
    expect(result.items[0].listing).toBeNull()
  })

  it("drops the rows the blocking filter excludes", async () => {
    findMany.mockResolvedValue([locationRow(), locationRow({ id: "loc-2", name: "Denver" })])
    unresolvedSalonLocations.mockImplementation((rows: { id: string }[]) =>
      rows.filter((r) => r.id === "loc-2"),
    )
    const result = await unresolvedMappings()
    expect(result.items.map((i) => i.location_id)).toEqual(["loc-2"])
  })
})

describe("unresolvedMappings when BigQuery is unavailable", () => {
  beforeEach(() => {
    // listLocationNames() resolves null when BigQuery is unconfigured or unreachable.
    listLocationNames.mockResolvedValue(null)
  })

  it("still lists the blocking locations, with bq_configured false", async () => {
    const result = await unresolvedMappings()
    expect(result.bq_configured).toBe(false)
    expect(result.items.map((i) => i.location_id)).toEqual(["loc-1"])
  })

  it("nulls every suggestion without scoring anything", async () => {
    const result = await unresolvedMappings()
    expect(result.items[0].suggestion).toBeNull()
    // Not merely "no suggestion": the matcher is never consulted, so a null here
    // means "unknown", never "no match exists".
    expect(suggestLocationMatch).not.toHaveBeenCalled()
  })
})

describe("unresolvedMappings with no salon locations", () => {
  it("returns an empty list and still reports BigQuery as configured", async () => {
    findMany.mockResolvedValue([])
    const result = await unresolvedMappings()
    expect(result).toEqual({ items: [], bq_configured: true })
  })

  it("returns an empty list and reports BigQuery as unavailable", async () => {
    findMany.mockResolvedValue([])
    listLocationNames.mockResolvedValue(null)
    const result = await unresolvedMappings()
    expect(result).toEqual({ items: [], bq_configured: false })
  })
})
