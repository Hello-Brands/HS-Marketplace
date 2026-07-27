import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

// NOTE: userOwnerLinks is imported dynamically inside each test, alongside
// links.ts, rather than statically here. vi.resetModules() in beforeEach
// clears the module registry, so a static import captured once at file-load
// time would be a *different* object instance than the one links.ts sees
// after each reset — same shape, different identity, which breaks
// toHaveBeenCalledWith's deep-equal check against drizzle's self-referential
// table objects. Importing it fresh each test keeps both references in the
// same registry generation. (Same trap already solved in actions.test.ts.)

vi.mock("server-only", () => ({}))

// Partial mock: inArray/eq become spies that still delegate to the real
// implementation, so we can assert the exact column and values a query
// scopes by without matching the SQL AST it returns (brittle, couples to
// Drizzle internals).
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>()
  return { ...actual, inArray: vi.fn(actual.inArray), eq: vi.fn(actual.eq) }
})

const select = vi.fn()
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

describe("getEffectiveOwnerIdentifiers", () => {
  beforeEach(() => {
    vi.resetModules()
    // The inArray/eq spies live on the mocked drizzle-orm module and survive
    // resetModules (module cache reset, not mock history reset) — clear call
    // history explicitly so an assertion in one test can't be satisfied by a
    // call made during a different test.
    vi.clearAllMocks()
    select.mockReset()
  })

  it("scopes by userId and filters source IN (auto, manual), returning the mapped identifiers", async () => {
    select.mockReturnValue(
      builder([{ ownerIdentifier: "ut-lines-towns" }, { ownerIdentifier: "ut-towns" }])
    )

    const { userOwnerLinks } = await import("@/db/schema")
    const { inArray, eq } = await import("drizzle-orm")
    const { getEffectiveOwnerIdentifiers } = await import("@/lib/owner-directory/links")

    const result = await getEffectiveOwnerIdentifiers("user-1")

    expect(result).toEqual(["ut-lines-towns", "ut-towns"])
    // A dropped filter or a wrong source list must fail this assertion.
    expect(inArray).toHaveBeenCalledWith(userOwnerLinks.source, ["auto", "manual"])
    // Scoped to the right user.
    expect(eq).toHaveBeenCalledWith(userOwnerLinks.userId, "user-1")
  })

  it("returns an empty array when the user has no effective links", async () => {
    select.mockReturnValue(builder([]))

    const { getEffectiveOwnerIdentifiers } = await import("@/lib/owner-directory/links")
    expect(await getEffectiveOwnerIdentifiers("user-1")).toEqual([])
  })
})

describe("getUserOwnerLinks", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    select.mockReset()
  })

  it("does NOT filter by source, so revoked rows are returned to the reconciler", async () => {
    select.mockReturnValue(
      builder([
        { ownerIdentifier: "ut-towns", source: "revoked" },
        { ownerIdentifier: "ut-lines-towns", source: "auto" },
      ])
    )

    const { userOwnerLinks } = await import("@/db/schema")
    const { inArray, eq } = await import("drizzle-orm")
    const { getUserOwnerLinks } = await import("@/lib/owner-directory/links")

    const result = await getUserOwnerLinks("user-1")

    expect(result).toEqual([
      { ownerIdentifier: "ut-towns", source: "revoked" },
      { ownerIdentifier: "ut-lines-towns", source: "auto" },
    ])
    expect(eq).toHaveBeenCalledWith(userOwnerLinks.userId, "user-1")
    // The whole point: no source filter on this path.
    expect(inArray).not.toHaveBeenCalled()
  })
})
