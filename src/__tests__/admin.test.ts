import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Tests the REAL last-admin guards in src/app/admin/users/actions.ts
 * (setUserRole / removeUser). The db and session are mocked; the guard logic
 * under test is the production code itself.
 */

const {
  mockAuth,
  mockSelect,
  mockUpdate,
  mockDelete,
  mockUsersFindFirst,
  updateSetCalls,
  deleteWhere,
} = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = []
  const deleteWhere = vi.fn().mockResolvedValue(undefined)
  return {
    mockAuth: vi.fn(),
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    mockDelete: vi.fn(() => ({ where: deleteWhere })),
    mockUsersFindFirst: vi.fn(),
    updateSetCalls,
    deleteWhere,
  }
})

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
    query: {
      users: { findFirst: mockUsersFindFirst },
      allowlist: { findFirst: vi.fn() },
    },
  },
}))

import { setUserRole, removeUser } from "@/app/admin/users/actions"

/** Makes db.select({count}).from(users).where(...) resolve to the given admin count. */
function setAdminCount(n: number) {
  mockSelect.mockReturnValue({
    from: () => ({ where: () => Promise.resolve([{ count: n }]) }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
  mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
})

describe("setUserRole (real src/app/admin/users/actions.ts)", () => {
  it("rejects callers without an admin session", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "user" } })
    await expect(setUserRole("user-2", "admin")).rejects.toThrow(/Unauthorized/)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated callers", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(setUserRole("user-2", "admin")).rejects.toThrow(/Unauthorized/)
  })

  it("blocks the last admin from demoting themselves", async () => {
    setAdminCount(1)
    await expect(setUserRole("admin-1", "user")).rejects.toThrow(
      "Cannot demote the last admin"
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("allows self-demotion when another admin exists", async () => {
    setAdminCount(2)
    await expect(setUserRole("admin-1", "user")).resolves.toBeUndefined()
    expect(updateSetCalls).toContainEqual({ role: "user" })
  })

  it("allows demoting a different user without counting admins", async () => {
    await expect(setUserRole("admin-2", "user")).resolves.toBeUndefined()
    expect(mockSelect).not.toHaveBeenCalled()
    expect(updateSetCalls).toContainEqual({ role: "user" })
  })

  it("allows promoting a user to admin without the guard", async () => {
    await expect(setUserRole("user-2", "admin")).resolves.toBeUndefined()
    expect(mockSelect).not.toHaveBeenCalled()
    expect(updateSetCalls).toContainEqual({ role: "admin" })
  })
})

describe("removeUser (real src/app/admin/users/actions.ts)", () => {
  it("rejects callers without an admin session", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "user" } })
    await expect(removeUser("user-2")).rejects.toThrow(/Unauthorized/)
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("prevents an admin from removing themselves", async () => {
    await expect(removeUser("admin-1")).rejects.toThrow("Cannot remove yourself")
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("prevents removing the last admin", async () => {
    mockUsersFindFirst.mockResolvedValue({ id: "admin-2", role: "admin" })
    setAdminCount(1)
    await expect(removeUser("admin-2")).rejects.toThrow("Cannot remove the last admin")
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it("allows removing an admin when another admin remains", async () => {
    mockUsersFindFirst.mockResolvedValue({ id: "admin-2", role: "admin" })
    setAdminCount(2)
    await expect(removeUser("admin-2")).resolves.toBeUndefined()
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  it("removes a regular user without consulting the admin count", async () => {
    mockUsersFindFirst.mockResolvedValue({ id: "user-2", role: "user" })
    await expect(removeUser("user-2")).resolves.toBeUndefined()
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })
})
