import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Tests the REAL GET handler in src/app/api/cron/reminders/route.ts:
 * the CRON_SECRET bearer gate and the send-reminder / stamp-lastReminderSent flow.
 */

const { mockSelectWhere, mockUpdate, updateSetCalls, mockSendReminderEmail, mockCreateActionToken } =
  vi.hoisted(() => {
    const updateSetCalls: Record<string, unknown>[] = []
    return {
      mockSelectWhere: vi.fn(),
      mockUpdate: vi.fn(() => ({
        set: (payload: Record<string, unknown>) => {
          updateSetCalls.push(payload)
          return { where: vi.fn().mockResolvedValue(undefined) }
        },
      })),
      updateSetCalls,
      mockSendReminderEmail: vi.fn().mockResolvedValue(undefined),
      mockCreateActionToken: vi.fn().mockResolvedValue("tok-abc123"),
    }
  })

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({ innerJoin: () => ({ where: mockSelectWhere }) }),
    })),
    update: mockUpdate,
  },
}))
vi.mock("@/lib/email", () => ({ sendReminderEmail: mockSendReminderEmail }))
vi.mock("@/lib/listings/action-tokens", () => ({ createActionToken: mockCreateActionToken }))

import { GET } from "@/app/api/cron/reminders/route"

const CRON_SECRET = "test-cron-secret"

function makeRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/reminders", {
    headers: authorization ? { authorization } : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://test.example")
  mockSelectWhere.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("cron reminders auth gate", () => {
  it("returns 401 without an Authorization header and does not query the db", async () => {
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
    expect(mockSelectWhere).not.toHaveBeenCalled()
    expect(mockSendReminderEmail).not.toHaveBeenCalled()
  })

  it("returns 401 with a wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"))
    expect(res.status).toBe(401)
    expect(mockSendReminderEmail).not.toHaveBeenCalled()
  })

  it("returns 200 with the valid CRON_SECRET bearer", async () => {
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ success: true, sent: 0 })
  })
})

describe("cron reminders send flow", () => {
  const staleDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)

  it("sends a reminder with a mark-sold action link and stamps lastReminderSent", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        listing: { id: "L1", title: "Sweet Suite", updatedAt: staleDate },
        seller: { email: "seller@hellosugar.salon", name: "Jane" },
      },
    ])

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body.sent).toBe(1)

    expect(mockCreateActionToken).toHaveBeenCalledWith("markSold", "L1")
    expect(mockSendReminderEmail).toHaveBeenCalledTimes(1)
    const emailArgs = mockSendReminderEmail.mock.calls[0][0]
    expect(emailArgs.sellerEmail).toBe("seller@hellosugar.salon")
    expect(emailArgs.markSoldUrl).toBe("https://test.example/api/actions/tok-abc123")

    // lastReminderSent stamped after the send
    expect(updateSetCalls).toHaveLength(1)
    expect(updateSetCalls[0].lastReminderSent).toBeInstanceOf(Date)
  })

  it("skips sellers without an email and does not stamp them", async () => {
    mockSelectWhere.mockResolvedValue([
      {
        listing: { id: "L2", title: "No Email Salon", updatedAt: staleDate },
        seller: { email: null, name: "Ghost" },
      },
    ])

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const body = await res.json()
    expect(body.sent).toBe(0)
    expect(mockSendReminderEmail).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
