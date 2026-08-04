import { describe, it, expect, vi, beforeEach } from "vitest"

const findFirst = vi.fn()
const select = vi.fn()
const insert = vi.fn()
const deleteFn = vi.fn()
vi.mock("@/db", () => ({
  db: {
    query: { users: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
    update: vi.fn(),
    delete: (...a: unknown[]) => deleteFn(...a),
  },
}))
vi.mock("@/lib/owner-directory/links", () => ({
  getEffectiveOwnerIdentifiers: vi.fn(async () => []),
}))
vi.mock("@/lib/competitor-alert-log", () => ({
  seedCompetitorLedger: vi.fn(async () => {}),
}))

import { getEffectiveOwnerIdentifiers } from "@/lib/owner-directory/links"
import { seedCompetitorLedger } from "@/lib/competitor-alert-log"
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

  it("rolls back an alert whose ledger seeding failed", async () => {
    findFirst.mockResolvedValue({ ownerAlertsChoice: "enabled" })
    vi.mocked(getEffectiveOwnerIdentifiers).mockResolvedValue(["owner-1"])
    // 1st select = owned locations, 2nd = existing owner-auto alerts.
    select
      .mockReturnValueOnce({
        from: () => ({
          where: async () => [
            { ownerIdentifier: "owner-1", locationName: "Provo", latitude: 40.2, longitude: -111.6 },
          ],
        }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ orderBy: async () => [] }) }),
      })
    insert.mockReturnValue({
      values: () => ({ returning: async () => [{ id: "new-alert" }] }),
    })
    vi.mocked(seedCompetitorLedger).mockRejectedValueOnce(new Error("seed boom"))
    const deleteWhere = vi.fn(async () => undefined)
    deleteFn.mockReturnValue({ where: deleteWhere })

    // Never throws, and the unseeded row is removed rather than left live —
    // otherwise the weekly cron would email every pre-existing closure.
    await expect(reconcileOwnerAutoAlerts("u1")).resolves.toBeUndefined()

    expect(insert).toHaveBeenCalledTimes(1)
    expect(deleteFn).toHaveBeenCalledTimes(1)
    expect(deleteWhere).toHaveBeenCalledTimes(1)
  })
})
