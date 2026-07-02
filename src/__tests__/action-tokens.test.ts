import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { SignJWT } from "jose"

/**
 * Tests the REAL JWT action-token functions in src/lib/listings/action-tokens.ts:
 * create/verify round-trip, tamper + expiry + wrong-secret rejection, and the
 * executeAction status-machine gate. Only @/db is mocked.
 */

const { mockFindFirst, mockUpdate, updateSetCalls } = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = []
  return {
    mockFindFirst: vi.fn(),
    mockUpdate: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    updateSetCalls,
  }
})

vi.mock("@/db", () => ({
  db: {
    query: { listings: { findFirst: mockFindFirst } },
    update: mockUpdate,
  },
}))

import {
  createActionToken,
  verifyActionToken,
  executeAction,
} from "@/lib/listings/action-tokens"

const SECRET = "test-action-token-secret"

/** Signs an arbitrary payload with the given secret (test fixture builder). */
async function signRaw(
  payload: Record<string, unknown>,
  secret: string,
  expSecondsFromNow: number
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSecondsFromNow)
    .sign(new TextEncoder().encode(secret))
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
  vi.stubEnv("ACTION_TOKEN_SECRET", SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("createActionToken / verifyActionToken", () => {
  it("round-trips a token: create then verify returns the action and listingId", async () => {
    const token = await createActionToken("markSold", "listing-123")
    const result = await verifyActionToken(token)
    expect(result.success).toBe(true)
    expect(result.action).toBe("markSold")
    expect(result.listingId).toBe("listing-123")
  })

  it("rejects a tampered token", async () => {
    const token = await createActionToken("markSold", "listing-123")
    // Flip the last character of the signature segment.
    const last = token.at(-1)
    const tampered = token.slice(0, -1) + (last === "A" ? "B" : "A")
    const result = await verifyActionToken(tampered)
    expect(result.success).toBe(false)
    expect(result.action).toBeUndefined()
    expect(result.message).toMatch(/Invalid or expired/)
  })

  it("rejects a token signed with a different secret", async () => {
    const forged = await signRaw(
      { action: "markSold", listingId: "listing-123" },
      "some-other-secret",
      3600
    )
    const result = await verifyActionToken(forged)
    expect(result.success).toBe(false)
  })

  it("rejects an expired token", async () => {
    const expired = await signRaw(
      { action: "markSold", listingId: "listing-123" },
      SECRET,
      -3600 // expired an hour ago
    )
    const result = await verifyActionToken(expired)
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/Invalid or expired/)
  })

  it("rejects garbage that is not a JWT at all", async () => {
    const result = await verifyActionToken("not-a-jwt")
    expect(result.success).toBe(false)
  })
})

describe("executeAction", () => {
  it("refuses to run with an invalid token and never touches the db", async () => {
    const result = await executeAction("not-a-jwt")
    expect(result.success).toBe(false)
    expect(mockFindFirst).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("returns 'Listing not found' when the listing does not exist", async () => {
    mockFindFirst.mockResolvedValue(undefined)
    const token = await createActionToken("markSold", "missing-listing")
    const result = await executeAction(token)
    expect(result.success).toBe(false)
    expect(result.message).toBe("Listing not found")
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("marks an active listing sold", async () => {
    mockFindFirst.mockResolvedValue({ id: "L1", status: "active" })
    const token = await createActionToken("markSold", "L1")
    const result = await executeAction(token)
    expect(result.success).toBe(true)
    expect(updateSetCalls).toHaveLength(1)
    expect(updateSetCalls[0].status).toBe("sold")
  })

  it("refuses markSold from an illegal status (canTransition gate)", async () => {
    mockFindFirst.mockResolvedValue({ id: "L1", status: "pending" })
    const token = await createActionToken("markSold", "L1")
    const result = await executeAction(token)
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/cannot be marked as sold/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("refuses markSold on an already-sold listing", async () => {
    mockFindFirst.mockResolvedValue({ id: "L1", status: "sold" })
    const token = await createActionToken("markSold", "L1")
    const result = await executeAction(token)
    expect(result.success).toBe(false)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("confirmActive resets the reminder timer", async () => {
    mockFindFirst.mockResolvedValue({ id: "L2", status: "active" })
    const token = await createActionToken("confirmActive", "L2")
    const result = await executeAction(token)
    expect(result.success).toBe(true)
    expect(updateSetCalls).toHaveLength(1)
    expect(updateSetCalls[0].lastReminderSent).toBeNull()
  })

  it("rejects a validly-signed token carrying an unknown action", async () => {
    mockFindFirst.mockResolvedValue({ id: "L3", status: "active" })
    const rogue = await signRaw({ action: "deleteEverything", listingId: "L3" }, SECRET, 3600)
    const result = await executeAction(rogue)
    expect(result.success).toBe(false)
    expect(result.message).toBe("Unknown action")
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
