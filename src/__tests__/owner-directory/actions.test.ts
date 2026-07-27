import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

// NOTE: userOwnerLinks is imported dynamically inside each test, alongside
// actions.ts, rather than statically here. vi.resetModules() in beforeEach
// clears the module registry, so a static import captured once at file-load
// time would be a *different* object instance than the one actions.ts sees
// after each reset — same shape, different identity, which breaks
// toHaveBeenCalledWith's deep-equal check against drizzle's self-referential
// table objects. Importing it fresh each test keeps both references in the
// same registry generation.

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

  it("upserts a manual link when the owner exists, writing source=manual and the actor", async () => {
    select.mockReturnValue(builder([{ id: "ol-1" }]))
    const insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)
    const { userOwnerLinks } = await import("@/db/schema")
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await addOwnerLink("user-1", "ut-towns")).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(userOwnerLinks)
    expect(insertBuilder.calls.values[0][0]).toMatchObject({
      userId: "user-1",
      ownerIdentifier: "ut-towns",
      source: "manual",
      actorUserId: "admin-1",
    })
    expect(insertBuilder.calls.onConflictDoUpdate[0][0]).toMatchObject({
      target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
    })
    expect(insertBuilder.calls.onConflictDoUpdate[0][0].set).toMatchObject({
      source: "manual",
      actorUserId: "admin-1",
    })
  })

  it("writes actorUserId as null when the admin session has no id", async () => {
    requireAdmin.mockReset().mockResolvedValue({ role: "admin" })
    select.mockReturnValue(builder([{ id: "ol-1" }]))
    const insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await addOwnerLink("user-1", "ut-towns")).toEqual({ ok: true })
    expect(insertBuilder.calls.values[0][0]).toMatchObject({ actorUserId: null })
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

  it("revokes WITHOUT requiring the owner to still be in the directory, writing source=revoked and the actor", async () => {
    const insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)
    const { userOwnerLinks } = await import("@/db/schema")
    const { revokeOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await revokeOwnerLink("user-1", "vanished-owner")).toEqual({ ok: true })
    expect(select).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert).toHaveBeenCalledWith(userOwnerLinks)
    expect(insertBuilder.calls.values[0][0]).toMatchObject({
      userId: "user-1",
      ownerIdentifier: "vanished-owner",
      source: "revoked",
      actorUserId: "admin-1",
    })
    expect(insertBuilder.calls.onConflictDoUpdate[0][0]).toMatchObject({
      target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
    })
    expect(insertBuilder.calls.onConflictDoUpdate[0][0].set).toMatchObject({
      source: "revoked",
      actorUserId: "admin-1",
    })
  })

  it("requires an admin (revokeOwnerLink)", async () => {
    requireAdmin.mockRejectedValue(new Error("Admin access required"))
    const { revokeOwnerLink } = await import("@/lib/owner-directory/actions")
    await expect(revokeOwnerLink("user-1", "ut-towns")).rejects.toThrow("Admin access required")
  })

  it("clears a link by deleting the row from the link table", async () => {
    const delBuilder = builder(undefined)
    del.mockReturnValue(delBuilder)
    const { userOwnerLinks } = await import("@/db/schema")
    const { clearOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await clearOwnerLink("user-1", "ut-towns")).toEqual({ ok: true })
    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith(userOwnerLinks)
  })

  it("requires an admin (clearOwnerLink)", async () => {
    requireAdmin.mockRejectedValue(new Error("Admin access required"))
    const { clearOwnerLink } = await import("@/lib/owner-directory/actions")
    await expect(clearOwnerLink("user-1", "ut-towns")).rejects.toThrow("Admin access required")
  })
})
