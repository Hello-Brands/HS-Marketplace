import { describe, it, expect, vi, beforeEach } from "vitest"

const { select, update, del, usersFindFirst, allowlistFindFirst, insert, updateSetCalls, withAudit } = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = []
  return {
    select: vi.fn(),
    updateSetCalls,
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    del: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    usersFindFirst: vi.fn(),
    allowlistFindFirst: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    withAudit: vi.fn(
      async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, fn: () => Promise<unknown>) => ({
        result: await fn(),
        auditId: "audit-1",
      }),
    ),
  }
})

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/db", () => ({
  db: {
    select,
    update,
    delete: del,
    insert,
    query: {
      users: { findFirst: usersFindFirst },
      allowlist: { findFirst: allowlistFindFirst },
    },
  },
}))

import { setUserRole, removeUser } from "@/lib/admin/core/users"
import { addToAllowlist } from "@/lib/admin/core/allowlist"

const actor = { userId: "admin-1", source: "ui" as const }

function setAdminCount(n: number) {
  select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ count: n }]) }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
})

describe("core setUserRole", () => {
  it("blocks the last admin demoting themselves, using the actor id", async () => {
    setAdminCount(1)
    await expect(setUserRole(actor, "admin-1", "user")).rejects.toThrow("Cannot demote the last admin")
    expect(update).not.toHaveBeenCalled()
  })

  it("promotes and returns the audit id", async () => {
    expect(await setUserRole(actor, "u2", "admin")).toEqual({ auditId: "audit-1" })
    expect(updateSetCalls[0]).toEqual({ role: "admin" })
    expect(withAudit).toHaveBeenCalledWith(actor, "user.set_role", { type: "user", id: "u2" }, { userId: "u2", role: "admin" }, expect.any(Function))
  })
})

describe("core removeUser", () => {
  it("refuses to remove the actor", async () => {
    await expect(removeUser(actor, "admin-1")).rejects.toThrow("Cannot remove yourself")
    expect(del).not.toHaveBeenCalled()
  })

  it("refuses to remove the last admin", async () => {
    usersFindFirst.mockResolvedValue({ id: "a2", role: "admin" })
    setAdminCount(1)
    await expect(removeUser(actor, "a2")).rejects.toThrow("Cannot remove the last admin")
  })

  it("deletes a plain user", async () => {
    usersFindFirst.mockResolvedValue({ id: "u3", role: "user" })
    expect(await removeUser(actor, "u3")).toEqual({ auditId: "audit-1" })
    expect(del).toHaveBeenCalledTimes(1)
  })
})

describe("core addToAllowlist", () => {
  it("returns ok:false for a duplicate without inserting, and still carries auditId", async () => {
    allowlistFindFirst.mockResolvedValue({ email: "a@b.com" })
    expect(await addToAllowlist(actor, "a@b.com")).toEqual({ ok: false, error: "Email already in allowlist", auditId: "audit-1" })
    expect(insert).not.toHaveBeenCalled()
  })

  it("inserts a new domain entry stamped with the actor", async () => {
    allowlistFindFirst.mockResolvedValue(undefined)
    const values = vi.fn().mockResolvedValue(undefined)
    insert.mockReturnValue({ values })
    expect(await addToAllowlist(actor, "@partner.com")).toEqual({ ok: true, auditId: "audit-1" })
    expect(values).toHaveBeenCalledWith({ email: "@partner.com", addedBy: "admin-1" })
  })
})
