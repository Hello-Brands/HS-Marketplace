import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
vi.mock("server-only", () => ({}))

describe("fetchMonthlyMembership", () => {
  const env = process.env
  beforeEach(() => { vi.resetModules(); process.env = { ...env, BOULEVARD_API_URL: "https://blvd.test/admin", BOULEVARD_API_KEY: "k" } })
  afterEach(() => { process.env = env; vi.restoreAllMocks() })

  it("computes rate = newMembers / uniqueOrderingClients", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      data: { location: { monthlyMembership: [
        { month: "2026-05", newMembers: 30, uniqueOrderingClients: 120 },
      ] } } }) })
    const { fetchMonthlyMembership } = await import("@/lib/boulevard/client")
    expect(await fetchMonthlyMembership("b1", 12)).toEqual([{ month: "2026-05", rate: 0.25 }])
  })

  it("rate is 0 when there are no ordering clients", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({
      data: { location: { monthlyMembership: [
        { month: "2026-05", newMembers: 5, uniqueOrderingClients: 0 },
      ] } } }) })
    const { fetchMonthlyMembership } = await import("@/lib/boulevard/client")
    expect((await fetchMonthlyMembership("b1", 12))![0].rate).toBe(0)
  })

  it("returns null on API error", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const { fetchMonthlyMembership } = await import("@/lib/boulevard/client")
    expect(await fetchMonthlyMembership("b1", 12)).toBeNull()
  })
})
