import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

const { select, insert, del, withAudit } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
  withAudit: vi.fn(
    async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, fn: () => Promise<unknown>) => ({
      result: await fn(),
      auditId: "audit-1",
    }),
  ),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

import { addOwnerLink, revokeOwnerLink } from "@/lib/admin/core/owner-links"

const actor = { userId: "admin-1", source: "ui" as const }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("core addOwnerLink", () => {
  it("refuses Unknown Owner and returns ok:false with auditId", async () => {
    expect(await addOwnerLink(actor, "u1", "Unknown Owner")).toEqual({
      ok: false,
      error: "Unknown Owner cannot be assigned to a user",
      auditId: "audit-1",
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it("upserts source=manual stamped with the actor", async () => {
    select.mockReturnValue(builder([{ id: "ol-1" }]))
    const ins = builder(undefined)
    insert.mockReturnValue(ins)
    expect(await addOwnerLink(actor, "u1", "ut-towns")).toEqual({ ok: true, auditId: "audit-1" })
    expect(ins.calls.values[0][0]).toMatchObject({ userId: "u1", ownerIdentifier: "ut-towns", source: "manual", actorUserId: "admin-1" })
    expect(withAudit).toHaveBeenCalledWith(actor, "owner_link.add", { type: "owner_link", id: "u1:ut-towns" }, { userId: "u1", ownerIdentifier: "ut-towns" }, expect.any(Function))
  })
})

describe("core revokeOwnerLink", () => {
  it("upserts source=revoked without validating directory membership", async () => {
    const ins = builder(undefined)
    insert.mockReturnValue(ins)
    expect(await revokeOwnerLink(actor, "u1", "ghost")).toEqual({ ok: true, auditId: "audit-1" })
    expect(select).not.toHaveBeenCalled()
    expect(ins.calls.values[0][0]).toMatchObject({ source: "revoked", actorUserId: "admin-1" })
  })
})
