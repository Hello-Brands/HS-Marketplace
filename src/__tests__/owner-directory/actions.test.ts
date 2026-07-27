import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const requireAdmin = vi.fn()
vi.mock("@/lib/auth-guards", () => ({ requireAdmin }))

const select = vi.fn()
const insert = vi.fn()
const del = vi.fn()
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

vi.mock("@/lib/owner-directory/sync", () => ({ syncOwnerLocations: vi.fn() }))

describe("addOwnerLink", () => {
  beforeEach(() => {
    vi.resetModules()
    requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" })
    select.mockReset()
    insert.mockReset()
    del.mockReset()
  })

  it("refuses to assign the Unknown Owner bucket, without touching the DB", async () => {
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    const res = await addOwnerLink("user-1", "Unknown Owner")
    expect(res).toEqual({ ok: false, error: "Unknown Owner cannot be assigned to a user" })
    expect(select).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it("refuses an owner_identifier absent from the directory", async () => {
    select.mockReturnValue(builder([]))
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await addOwnerLink("user-1", "ghost-owner")).toEqual({
      ok: false,
      error: "Unknown owner_identifier: ghost-owner",
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it("upserts a manual link when the owner exists", async () => {
    select.mockReturnValue(builder([{ id: "ol-1" }]))
    insert.mockReturnValue(builder(undefined))
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await addOwnerLink("user-1", "ut-towns")).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("requires an admin", async () => {
    requireAdmin.mockRejectedValue(new Error("Admin access required"))
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    await expect(addOwnerLink("user-1", "ut-towns")).rejects.toThrow("Admin access required")
  })
})

describe("revokeOwnerLink / clearOwnerLink", () => {
  beforeEach(() => {
    vi.resetModules()
    requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" })
    select.mockReset()
    insert.mockReset()
    del.mockReset()
  })

  it("revokes WITHOUT requiring the owner to still be in the directory", async () => {
    insert.mockReturnValue(builder(undefined))
    const { revokeOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await revokeOwnerLink("user-1", "vanished-owner")).toEqual({ ok: true })
    expect(select).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("clears a link by deleting the row", async () => {
    del.mockReturnValue(builder(undefined))
    const { clearOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await clearOwnerLink("user-1", "ut-towns")).toEqual({ ok: true })
    expect(del).toHaveBeenCalledTimes(1)
  })
})
