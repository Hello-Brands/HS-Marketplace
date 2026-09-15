import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const { select } = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

import { listAlerts } from "@/lib/mcp/queries/alerts"
import { decodeCursor } from "@/lib/mcp/tools/_shared"

function row(id: string, at: string) {
  return {
    id,
    name: "Denver metro",
    origin: "user",
    userId: "u-2",
    userName: "Buyer Bob",
    userEmail: "bob@example.com",
    states: ["CO"],
    listingTypes: ["salon"],
    minPrice: 15_000_000,
    maxPrice: null,
    minYearsOpen: 3,
    inventoryIncluded: true,
    radiusMiles: 25,
    centerLabel: "Denver, CO",
    ownerIdentifier: null,
    notifyEnabled: true,
    includeListings: true,
    includeCompetitors: false,
    createdAt: new Date(at),
    updatedAt: new Date(at),
  }
}

describe("listAlerts", () => {
  let b: ChainedBuilder

  beforeEach(() => {
    select.mockReset()
    b = builder([row("a1", "2026-09-14T12:00:00.000Z"), row("a2", "2026-09-14T11:00:00.000Z")])
    select.mockReturnValue(b)
  })

  it("serialises a saved search into the wire shape, money in cents", async () => {
    const page = await listAlerts({ limit: 25 })
    expect(page.items[0]).toEqual({
      id: "a1",
      name: "Denver metro",
      origin: "user",
      owner: { id: "u-2", name: "Buyer Bob", email: "bob@example.com" },
      states: ["CO"],
      listing_types: ["salon"],
      min_price: { cents: 15_000_000, formatted: "$150,000" },
      max_price: null,
      min_years_open: 3,
      inventory_included: true,
      radius_miles: 25,
      center_label: "Denver, CO",
      owner_identifier: null,
      notify_enabled: true,
      include_listings: true,
      include_competitors: false,
      created_at: "2026-09-14T12:00:00.000Z",
      updated_at: "2026-09-14T12:00:00.000Z",
    })
  })

  it("asks for one more row than the limit so it knows whether a page follows", async () => {
    await listAlerts({ limit: 25 })
    expect(b.calls.limit[0][0]).toBe(26)
  })

  it("returns a null cursor when the fetched rows fit in the page", async () => {
    expect((await listAlerts({ limit: 25 })).next_cursor).toBeNull()
  })

  it("trims the sentinel row and emits a keyset cursor when more remain", async () => {
    const page = await listAlerts({ limit: 1 })
    expect(page.items.map((i) => i.id)).toEqual(["a1"])
    expect(decodeCursor(page.next_cursor ?? undefined)).toEqual({
      at: "2026-09-14T12:00:00.000Z",
      id: "a1",
    })
  })

  it("adds no WHERE clause when nothing is filtered", async () => {
    await listAlerts({ limit: 25 })
    expect(b.calls.where[0][0]).toBeUndefined()
  })

  it("filters when a criterion is given", async () => {
    await listAlerts({ limit: 25, userId: "u-2", origin: "user", notifyEnabled: false })
    expect(b.calls.where[0][0]).toBeDefined()
  })

  it("ignores a hand-edited cursor rather than throwing", async () => {
    const page = await listAlerts({ limit: 25, cursor: "not-a-cursor" })
    expect(page.items).toHaveLength(2)
    expect(b.calls.where[0][0]).toBeUndefined()
  })
})
