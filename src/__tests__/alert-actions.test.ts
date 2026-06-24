import { describe, it, expect, vi, beforeEach } from "vitest"

// Hoist mock variables so they are available in the vi.mock factory
const { mockAuth, mockInsert, mockUpdate, mockDelete, mockFindFirst, mockFindMany, mockSelect, mockSendAlertMatchEmail } =
  vi.hoisted(() => {
    const mockAuth = vi.fn()
    const mockInsert = vi.fn()
    const mockUpdate = vi.fn()
    const mockDelete = vi.fn()
    const mockFindFirst = vi.fn()
    const mockFindMany = vi.fn()
    const mockSelect = vi.fn()
    const mockSendAlertMatchEmail = vi.fn()
    return {
      mockAuth,
      mockInsert,
      mockUpdate,
      mockDelete,
      mockFindFirst,
      mockFindMany,
      mockSelect,
      mockSendAlertMatchEmail,
    }
  })

vi.mock("@/auth", () => ({ auth: mockAuth }))

vi.mock("@/db", () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    query: {
      alerts: {
        findFirst: mockFindFirst,
        findMany: mockFindMany,
      },
    },
    select: mockSelect,
  },
}))

vi.mock("@/lib/email", () => ({
  sendAlertMatchEmail: mockSendAlertMatchEmail,
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

// Import after mocks are set up
import {
  createAlert,
  updateAlert,
  deleteAlert,
  getMyAlerts,
  triggerAlertMatching,
} from "@/lib/alert-actions"

const MOCK_USER_ID = "user-123"
const MOCK_USER_EMAIL = "buyer@example.com"
const MOCK_USER_NAME = "Test Buyer"
const MOCK_ALERT_ID = "alert-abc"

function mockSession() {
  mockAuth.mockResolvedValue({ user: { id: MOCK_USER_ID } })
}

function mockNoSession() {
  mockAuth.mockResolvedValue(null)
}

function makeInsertChain(returning: unknown[]) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(returning),
    }),
  }
}

function makeUpdateChain() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }
}

function makeDeleteChain() {
  return {
    where: vi.fn().mockResolvedValue(undefined),
  }
}

describe("createAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test 1: returns error if not authenticated
  it("returns error if not authenticated", async () => {
    mockNoSession()

    const result = await createAlert({ states: ["TX"] })

    expect(result).toEqual({ error: "Not authenticated" })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("persists the full filter set", async () => {
    mockSession()
    const fakeAlert = { id: MOCK_ALERT_ID, userId: MOCK_USER_ID }
    const valuesSpy = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([fakeAlert]) })
    mockInsert.mockReturnValue({ values: valuesSpy })

    await createAlert({
      states: ["UT"], listingTypes: ["suite"], minPrice: 50000000, maxPrice: 100000000,
      minYearsOpen: 2, query: "salon", sort: "distance",
      centerLat: 40.2, centerLng: -111.6, radiusMiles: 25, centerLabel: "Provo, UT",
    })

    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: MOCK_USER_ID,
        states: ["UT"], listingTypes: ["suite"], minPrice: 50000000, maxPrice: 100000000,
        minYearsOpen: 2, query: "salon", sort: "distance",
        centerLat: 40.2, centerLng: -111.6, radiusMiles: 25, centerLabel: "Provo, UT",
      }),
    )
  })

  // Test 2: creates alert with states array only
  it("creates alert record with states array", async () => {
    mockSession()
    const fakeAlert = {
      id: MOCK_ALERT_ID,
      userId: MOCK_USER_ID,
      states: ["TX", "GA"],
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockInsert.mockReturnValue(makeInsertChain([fakeAlert]))

    const result = await createAlert({ states: ["TX", "GA"] })

    expect(mockInsert).toHaveBeenCalled()
    expect(result).toEqual({ success: true, alert: fakeAlert })
  })
})

describe("updateAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test 3: returns error if alert not owned by user
  it("returns error if alert not owned by user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "different-user" } })
    mockFindFirst.mockResolvedValue({
      id: MOCK_ALERT_ID,
      userId: MOCK_USER_ID, // owned by different user
      states: ["TX"],
    })

    const result = await updateAlert(MOCK_ALERT_ID, { states: ["GA"] })

    expect(result).toEqual({ error: "Alert not found" })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  // Test 4: updates alert states
  it("updates alert states", async () => {
    mockSession()
    mockFindFirst.mockResolvedValue({
      id: MOCK_ALERT_ID,
      userId: MOCK_USER_ID,
      states: ["TX"],
    })
    mockUpdate.mockReturnValue(makeUpdateChain())

    const result = await updateAlert(MOCK_ALERT_ID, { states: ["GA", "FL"] })

    expect(mockUpdate).toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })
})

describe("deleteAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test 5: returns error if alert not owned by user
  it("returns error if alert not owned by user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "other-user" } })
    mockFindFirst.mockResolvedValue({
      id: MOCK_ALERT_ID,
      userId: MOCK_USER_ID,
      states: ["TX"],
    })

    const result = await deleteAlert(MOCK_ALERT_ID)

    expect(result).toEqual({ error: "Alert not found" })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  // Test 6: deletes alert record
  it("removes the alert record", async () => {
    mockSession()
    mockFindFirst.mockResolvedValue({
      id: MOCK_ALERT_ID,
      userId: MOCK_USER_ID,
      states: ["TX"],
    })
    mockDelete.mockReturnValue(makeDeleteChain())

    const result = await deleteAlert(MOCK_ALERT_ID)

    expect(mockDelete).toHaveBeenCalled()
    expect(result).toEqual({ success: true })
  })
})

describe("getMyAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test 7: returns only user's alerts
  it("returns only user alerts when authenticated", async () => {
    mockSession()
    const fakeAlerts = [
      { id: "a1", userId: MOCK_USER_ID, states: ["TX"], createdAt: new Date(), updatedAt: new Date() },
      { id: "a2", userId: MOCK_USER_ID, states: ["GA"], createdAt: new Date(), updatedAt: new Date() },
    ]
    mockFindMany.mockResolvedValue(fakeAlerts)

    const result = await getMyAlerts()

    expect(result).toEqual(fakeAlerts)
    expect(mockFindMany).toHaveBeenCalled()
  })

  it("returns empty array if not authenticated", async () => {
    mockNoSession()

    const result = await getMyAlerts()

    expect(result).toEqual([])
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})

describe("triggerAlertMatching", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendAlertMatchEmail.mockResolvedValue({ success: true })
  })

  // Test 8: finds matching alerts by state and sends emails
  it("sends emails to alerts that match listing state", async () => {
    const alertsWithUsers = [
      {
        alert: { id: "a1", userId: "u1", states: ["TX", "GA"], createdAt: new Date(), updatedAt: new Date() },
        user: { id: "u1", email: MOCK_USER_EMAIL, name: MOCK_USER_NAME },
      },
      {
        alert: { id: "a2", userId: "u2", states: ["FL"], createdAt: new Date(), updatedAt: new Date() },
        user: { id: "u2", email: "other@example.com", name: "Other Buyer" },
      },
    ]

    // Mock select().from().innerJoin() chain
    const selectChain = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockResolvedValue(alertsWithUsers),
      }),
    }
    mockSelect.mockReturnValue(selectChain)

    const listing = {
      id: "listing-1",
      type: "suite",
      city: "Austin",
      state: "TX",
      askingPrice: 50000000,
      locationName: "Austin Flagship",
    }

    const result = await triggerAlertMatching(listing)

    // Should match alert a1 (has TX in states), not a2 (has only FL)
    expect(result.matched).toBe(1)
    expect(mockSendAlertMatchEmail).toHaveBeenCalledTimes(1)
    expect(mockSendAlertMatchEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        buyerEmail: MOCK_USER_EMAIL,
        listingId: "listing-1",
        state: "TX",
      }),
    )
  })

  it("matches alert with empty states (matches all states)", async () => {
    const alertsWithUsers = [
      {
        alert: { id: "a1", userId: "u1", states: [], createdAt: new Date(), updatedAt: new Date() },
        user: { id: "u1", email: MOCK_USER_EMAIL, name: MOCK_USER_NAME },
      },
    ]

    const selectChain = {
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockResolvedValue(alertsWithUsers),
      }),
    }
    mockSelect.mockReturnValue(selectChain)

    const listing = {
      id: "listing-2",
      type: "flagship",
      city: "Miami",
      state: "FL",
      askingPrice: 75000000,
      locationName: "Miami Flagship",
    }

    const result = await triggerAlertMatching(listing)

    // Empty states = match all
    expect(result.matched).toBe(1)
    expect(mockSendAlertMatchEmail).toHaveBeenCalledTimes(1)
  })
})
