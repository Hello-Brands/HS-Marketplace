import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Tests the REAL GET handler in src/app/api/cron/sync-owner-directory/route.ts:
 * the CRON_SECRET bearer gate, the success passthrough, and the 500-on-failure path.
 */

const { mockSyncOwnerLocations } = vi.hoisted(() => ({
  mockSyncOwnerLocations: vi.fn(),
}))

vi.mock("@/lib/owner-directory/sync", () => ({
  syncOwnerLocations: mockSyncOwnerLocations,
}))

import { GET } from "@/app/api/cron/sync-owner-directory/route"

const CRON_SECRET = "test-cron-secret"

function makeRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/sync-owner-directory", {
    headers: authorization ? { authorization } : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  mockSyncOwnerLocations.mockResolvedValue({ synced: 12, skipped: 3 })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cron sync-owner-directory", () => {
  it("returns 401 without an Authorization header and does not sync", async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockSyncOwnerLocations).not.toHaveBeenCalled()
  })

  it("returns 401 with a wrong bearer token and does not sync", async () => {
    const res = await GET(makeRequest("Bearer wrong"))
    expect(res.status).toBe(401)
    expect(mockSyncOwnerLocations).not.toHaveBeenCalled()
  })

  it("returns 200 with sync results for a valid CRON_SECRET bearer", async () => {
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, synced: 12, skipped: 3 })
    expect(mockSyncOwnerLocations).toHaveBeenCalledTimes(1)
  })

  it("returns 500 with the error message when the sync throws", async () => {
    mockSyncOwnerLocations.mockRejectedValue(new Error("BigQuery unavailable"))
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ success: false, error: "BigQuery unavailable" })
  })
})
