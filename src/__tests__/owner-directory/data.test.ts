import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

// Partial mock: inArray becomes a spy that still delegates to the real
// implementation, so we can assert the exact column and identifiers a query
// scopes by without matching the SQL AST it returns (brittle, couples to
// Drizzle internals).
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>()
  return { ...actual, inArray: vi.fn(actual.inArray) }
})

const auth = vi.fn()
vi.mock("@/auth", () => ({ auth }))

const getEffectiveOwnerIdentifiers = vi.fn()
vi.mock("@/lib/owner-directory/links", () => ({
  getEffectiveOwnerIdentifiers,
  getUserOwnerLinks: vi.fn(),
}))

const select = vi.fn()
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

describe("getMyOwnerLocations", () => {
  beforeEach(() => {
    vi.resetModules()
    auth.mockReset()
    getEffectiveOwnerIdentifiers.mockReset()
    select.mockReset()
  })

  it("returns the merged locations across every linked owner profile", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } })
    getEffectiveOwnerIdentifiers.mockResolvedValue(["ut-lines-towns", "ut-towns"])
    select.mockReturnValue(builder([{ id: "a" }, { id: "b" }]))

    const { getMyOwnerLocations } = await import("@/lib/owner-directory/data")
    const { inArray } = await import("drizzle-orm")
    const { ownerLocations } = await import("@/db/schema")
    const result = await getMyOwnerLocations()

    expect(result.ownerIdentifiers).toEqual(["ut-lines-towns", "ut-towns"])
    expect(result.locations).toHaveLength(2)
    // Proves the query scopes by the right column and the right identifiers
    // (not merely that some `.where(...)` was called with something).
    expect(inArray).toHaveBeenCalledWith(ownerLocations.ownerIdentifier, [
      "ut-lines-towns",
      "ut-towns",
    ])
  })

  it("returns empty WITHOUT querying locations when the user has no links", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } })
    getEffectiveOwnerIdentifiers.mockResolvedValue([])

    const { getMyOwnerLocations } = await import("@/lib/owner-directory/data")
    expect(await getMyOwnerLocations()).toEqual({ ownerIdentifiers: [], locations: [] })
    expect(select).not.toHaveBeenCalled()
  })

  it("filters Unknown Owner out of the scope even if a link exists", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } })
    getEffectiveOwnerIdentifiers.mockResolvedValue(["Unknown Owner"])

    const { getMyOwnerLocations } = await import("@/lib/owner-directory/data")
    expect(await getMyOwnerLocations()).toEqual({ ownerIdentifiers: [], locations: [] })
    expect(select).not.toHaveBeenCalled()
  })

  it("returns empty for a signed-out visitor", async () => {
    auth.mockResolvedValue(null)

    const { getMyOwnerLocations } = await import("@/lib/owner-directory/data")
    expect(await getMyOwnerLocations()).toEqual({ ownerIdentifiers: [], locations: [] })
    expect(getEffectiveOwnerIdentifiers).not.toHaveBeenCalled()
  })
})
