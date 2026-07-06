import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Tests the REAL GET handler in src/app/api/cron/competitor-alerts/route.ts:
 * the CRON_SECRET bearer gate, the notify/scope skip conditions, and the
 * "record only after a successful send" invariant (route.ts:70-75).
 */

const {
  mockInnerJoin,
  mockGetCompetitorClosures,
  mockFilterByScope,
  mockSelectUnlogged,
  mockScopeIsBounded,
  mockGetLoggedIds,
  mockRecordAlerts,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockInnerJoin: vi.fn(),
  mockGetCompetitorClosures: vi.fn(),
  mockFilterByScope: vi.fn(),
  mockSelectUnlogged: vi.fn(),
  mockScopeIsBounded: vi.fn(),
  mockGetLoggedIds: vi.fn(),
  mockRecordAlerts: vi.fn().mockResolvedValue(undefined),
  mockSendEmail: vi.fn(),
}))

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({ from: () => ({ innerJoin: mockInnerJoin }) })),
  },
}))
vi.mock("@/lib/competitor-query", () => ({ getCompetitorClosures: mockGetCompetitorClosures }))
vi.mock("@/lib/competitor-filter", () => ({
  filterCompetitorsByScope: mockFilterByScope,
  selectUnloggedCompetitors: mockSelectUnlogged,
  scopeIsBounded: mockScopeIsBounded,
}))
vi.mock("@/lib/competitor-alert-log", () => ({
  getLoggedCompetitorPlaceIds: mockGetLoggedIds,
  recordCompetitorAlerts: mockRecordAlerts,
}))
vi.mock("@/lib/email", () => ({ sendCompetitorAlertEmail: mockSendEmail }))
vi.mock("@/lib/saved-search", () => ({ savedSearchToBrowseParams: vi.fn(() => "state=UT") }))

import { GET } from "@/app/api/cron/competitor-alerts/route"

const CRON_SECRET = "test-cron-secret"

function makeRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/competitor-alerts", {
    headers: authorization ? { authorization } : undefined,
  })
}

const competitor = {
  googlePlaceId: "place-1",
  brandName: "Waxy Rival",
  city: "Provo",
  state: "UT",
  nearestHsName: "Hello Sugar Provo",
  nearestHsMiles: 2.1,
  mapsUrl: "https://maps.example/place-1",
}

const alertRow = {
  alert: {
    id: "alert-1",
    userId: "u1",
    name: "Utah watch",
    notifyEnabled: true,
    includeCompetitors: true,
    centerLat: 40.2,
    centerLng: -111.7,
    radiusMiles: 25,
    states: [],
  },
  user: { id: "u1", email: "buyer@hellosugar.salon", name: "Buyer Bob" },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  mockGetCompetitorClosures.mockResolvedValue([competitor])
  mockInnerJoin.mockResolvedValue([])
  mockScopeIsBounded.mockReturnValue(true)
  mockFilterByScope.mockReturnValue([competitor])
  mockGetLoggedIds.mockResolvedValue(new Set())
  mockSelectUnlogged.mockReturnValue([competitor])
  mockSendEmail.mockResolvedValue({ success: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cron competitor-alerts auth gate", () => {
  it("returns 401 without an Authorization header and does no work", async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockGetCompetitorClosures).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns 401 with a wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer nope"))
    expect(res.status).toBe(401)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("returns 200 with the valid CRON_SECRET bearer", async () => {
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, processed: 0, emailed: 0, errors: 0 })
  })
})

describe("cron competitor-alerts processing", () => {
  it("emails fresh competitors and records them only after a successful send", async () => {
    mockInnerJoin.mockResolvedValue([alertRow])
    mockSendEmail.mockResolvedValue({ success: true })

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body).toEqual({ success: true, processed: 1, emailed: 1, errors: 0 })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockRecordAlerts).toHaveBeenCalledWith("alert-1", ["place-1"])
  })

  it("does NOT record competitors when the send is not confirmed (retries next run)", async () => {
    mockInnerJoin.mockResolvedValue([alertRow])
    mockSendEmail.mockResolvedValue({ success: false })

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body.emailed).toBe(0)
    expect(body.errors).toBe(0)
    expect(mockRecordAlerts).not.toHaveBeenCalled()
  })

  it("does NOT record competitors when the send throws, and counts an error", async () => {
    mockInnerJoin.mockResolvedValue([alertRow])
    mockSendEmail.mockRejectedValue(new Error("smtp down"))

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body.emailed).toBe(0)
    expect(body.errors).toBe(1)
    expect(mockRecordAlerts).not.toHaveBeenCalled()
  })

  it("skips alerts with notifications disabled", async () => {
    mockInnerJoin.mockResolvedValue([
      { ...alertRow, alert: { ...alertRow.alert, notifyEnabled: false } },
    ])
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("skips unbounded scopes (would match every closure)", async () => {
    mockInnerJoin.mockResolvedValue([alertRow])
    mockScopeIsBounded.mockReturnValue(false)
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body.processed).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it("skips sending when there are no fresh (unlogged) competitors", async () => {
    mockInnerJoin.mockResolvedValue([alertRow])
    mockSelectUnlogged.mockReturnValue([])
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body.processed).toBe(1)
    expect(body.emailed).toBe(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockRecordAlerts).not.toHaveBeenCalled()
  })
})
