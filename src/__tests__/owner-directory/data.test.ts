import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

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
    const result = await getMyOwnerLocations()

    expect(result.ownerIdentifiers).toEqual(["ut-lines-towns", "ut-towns"])
    expect(result.locations).toHaveLength(2)
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
