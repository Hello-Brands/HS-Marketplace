import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const selectDistinct = vi.fn()
const select = vi.fn()
const insert = vi.fn()
const del = vi.fn()
const batch = vi.fn()

vi.mock("@/db", () => ({
  db: {
    selectDistinct: (...a: unknown[]) => selectDistinct(...a),
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
    delete: (...a: unknown[]) => del(...a),
    batch: (...a: unknown[]) => batch(...a),
  },
}))

const MATCHES = [{ ownerIdentifier: "ut-lines-towns" }, { ownerIdentifier: "ut-towns" }]

describe("linkOwnerAtLogin", () => {
  beforeEach(() => {
    vi.resetModules()
    for (const m of [selectDistinct, select, insert, del, batch]) m.mockReset()
  })

  it("links a user to every owner profile their email matches", async () => {
    selectDistinct.mockReturnValue(builder(MATCHES))
    select.mockReturnValue(builder([])) // no existing links
    const insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    const plan = await linkOwnerAtLogin("user-1", "Austin@hellosugar.salon")

    expect(plan.toAdd).toEqual(["ut-lines-towns", "ut-towns"])
    expect(insert).toHaveBeenCalledTimes(1)
    // Assert the exact insert payload, not just that insert happened — this
    // is what catches a wrong field name or a missing/dropped `source`.
    expect(insertBuilder.calls.values).toEqual([
      [
        [
          { userId: "user-1", ownerIdentifier: "ut-lines-towns", source: "auto" },
          { userId: "user-1", ownerIdentifier: "ut-towns", source: "auto" },
        ],
      ],
    ])
    expect(batch).not.toHaveBeenCalled() // add-only needs no batch
  })

  it("batches an add and a remove together", async () => {
    selectDistinct.mockReturnValue(builder([{ ownerIdentifier: "fresh" }]))
    select.mockReturnValue(builder([{ ownerIdentifier: "stale", source: "auto" }]))
    const insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)
    del.mockReturnValue(builder(undefined))

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    const plan = await linkOwnerAtLogin("user-1", "a@b.com")

    expect(plan.toAdd).toEqual(["fresh"])
    expect(plan.toRemove).toEqual(["stale"])
    expect(insertBuilder.calls.values).toEqual([
      [[{ userId: "user-1", ownerIdentifier: "fresh", source: "auto" }]],
    ])
    expect(batch).toHaveBeenCalledTimes(1)
  })

  it("removes a stale auto link with no new match (remove-only branch, no batch)", async () => {
    // Directory matches nothing this login, but the user still has a stale
    // auto link from a previous match. This is the self-healing path the
    // whole reconciliation design depends on: toAdd is empty, toRemove is
    // not, so the delete must run directly (not batched — batch is only for
    // when both an add and a remove exist).
    selectDistinct.mockReturnValue(builder([]))
    select.mockReturnValue(builder([{ ownerIdentifier: "stale", source: "auto" }]))
    del.mockReturnValue(builder(undefined))

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    const plan = await linkOwnerAtLogin("user-1", "a@b.com")

    expect(plan.toAdd).toEqual([])
    expect(plan.toRemove).toEqual(["stale"])
    expect(del).toHaveBeenCalledTimes(1)
    expect(insert).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
  })

  it("writes nothing when the plan is empty", async () => {
    selectDistinct.mockReturnValue(builder([{ ownerIdentifier: "same" }]))
    select.mockReturnValue(builder([{ ownerIdentifier: "same", source: "auto" }]))

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    await linkOwnerAtLogin("user-1", "a@b.com")

    expect(insert).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
  })

  it("returns an empty plan and queries nothing for a blank email", async () => {
    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    expect(await linkOwnerAtLogin("user-1", "   ")).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [],
    })
    expect(selectDistinct).not.toHaveBeenCalled()
  })

  it("never throws when the database fails (must not block sign-in)", async () => {
    selectDistinct.mockImplementation(() => {
      throw new Error("neon exploded")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    await expect(linkOwnerAtLogin("user-1", "a@b.com")).resolves.toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [],
    })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
