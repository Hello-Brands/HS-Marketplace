import { describe, it, expect, vi, beforeEach } from "vitest"

const findFirst = vi.fn()
const select = vi.fn()
vi.mock("@/db", () => ({
  db: {
    query: { users: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    select: (...a: unknown[]) => select(...a),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock("@/lib/owner-directory/links", () => ({
  getEffectiveOwnerIdentifiers: vi.fn(async () => []),
}))
vi.mock("@/lib/competitor-alert-log", () => ({
  seedCompetitorLedger: vi.fn(async () => {}),
}))

import { reconcileOwnerAutoAlerts } from "@/lib/owner-alerts/reconcile"

describe("reconcileOwnerAutoAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does nothing unless the user opted in", async () => {
    findFirst.mockResolvedValue({ ownerAlertsChoice: null })
    await reconcileOwnerAutoAlerts("u1")
    expect(select).not.toHaveBeenCalled()
  })

  it("does nothing for a declined user", async () => {
    findFirst.mockResolvedValue({ ownerAlertsChoice: "declined" })
    await reconcileOwnerAutoAlerts("u1")
    expect(select).not.toHaveBeenCalled()
  })

  it("never throws (login must not break)", async () => {
    findFirst.mockRejectedValue(new Error("db down"))
    await expect(reconcileOwnerAutoAlerts("u1")).resolves.toBeUndefined()
  })
})
