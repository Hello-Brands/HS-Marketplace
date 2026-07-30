import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { BrandRequestStatus } from "@/db/schema/brandRequests"

/**
 * Exercises the REAL actions in src/lib/brand-requests/actions.ts. Session, db,
 * next/cache and the GitHub dispatch bridge are mocked; the validation, dedupe
 * and status-gate logic under test is the production code.
 */

const {
  mockAuth,
  mockDispatch,
  mockMonitoredFindFirst,
  mockRequestFindFirst,
  mockInsert,
  mockUpdate,
  insertValues,
  updateSetCalls,
} = vi.hoisted(() => {
  const insertValues = vi.fn().mockResolvedValue(undefined)
  const updateSetCalls: Record<string, unknown>[] = []
  return {
    mockAuth: vi.fn(),
    mockDispatch: vi.fn(),
    mockMonitoredFindFirst: vi.fn(),
    mockRequestFindFirst: vi.fn(),
    mockInsert: vi.fn(() => ({ values: insertValues })),
    mockUpdate: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    insertValues,
    updateSetCalls,
  }
})

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/brand-requests/dispatch", () => ({
  dispatchMonitorEvent: mockDispatch,
}))
vi.mock("@/db", () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    query: {
      monitoredBrands: { findFirst: mockMonitoredFindFirst },
      brandRequests: { findFirst: mockRequestFindFirst },
    },
  },
}))

// Import after mocks
import {
  submitBrandRequest,
  approveBrandRequest,
  rejectBrandRequest,
  retryMonitorDispatch,
} from "@/lib/brand-requests/actions"
import { __resetRateLimits } from "@/lib/rate-limit"

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.append(key, value)
  return fd
}

const VALID_FORM = {
  brandName: "Wax Rivals",
  websiteUrl: "www.waxrivals.com",
  note: "Two of their shops are near my territory.",
  knownCityState: "Austin, TX",
}

/** A brand_requests row with just the columns the actions read. */
function requestRow(status: BrandRequestStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1",
    brandName: "Wax Rivals",
    normalizedDomain: "waxrivals.com",
    status,
    submittedBy: "user-1",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetRateLimits()
  updateSetCalls.length = 0
  mockAuth.mockResolvedValue({ user: { id: "user-1", role: "user" } })
  mockDispatch.mockResolvedValue({ ok: true })
  mockMonitoredFindFirst.mockResolvedValue(undefined)
  mockRequestFindFirst.mockResolvedValue(undefined)
  mockInsert.mockReturnValue({ values: insertValues })
  // The reachability probe resolves by default.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }))
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("submitBrandRequest", () => {
  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null)

    const result = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(result).toEqual({ error: "Not authenticated" })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("rejects a brand name that is too short", async () => {
    const result = await submitBrandRequest(
      null,
      makeFormData({ ...VALID_FORM, brandName: "X" }),
    )

    expect(result).toHaveProperty("error")
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("rejects a missing website", async () => {
    const result = await submitBrandRequest(null, makeFormData({ brandName: "Wax Rivals" }))

    expect(result).toHaveProperty("error")
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("rejects an unparseable website", async () => {
    const result = await submitBrandRequest(
      null,
      makeFormData({ ...VALID_FORM, websiteUrl: "waxrivals" }),
    )

    expect(result).toEqual({
      error: "Enter a valid website address (e.g. https://brandname.com).",
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("rejects a social/review domain", async () => {
    const result = await submitBrandRequest(
      null,
      makeFormData({ ...VALID_FORM, websiteUrl: "https://www.facebook.com/waxrivals" }),
    )

    expect(result).toEqual({
      error:
        "That looks like a social or review page. Please link to the brand's own website instead.",
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("rejects a website that cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ENOTFOUND")))

    const result = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(result).toEqual({
      error: "We couldn't reach that website. Double-check the address and try again.",
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("accepts a website that answers with an HTTP error (WAF / no root page)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }))

    const result = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(result).toEqual({ success: true })
    expect(insertValues).toHaveBeenCalled()
  })

  it("blocks a domain that is already monitored", async () => {
    mockMonitoredFindFirst.mockResolvedValue({
      brandId: "wr",
      name: "Wax Rivals",
      domain: "waxrivals.com",
    })

    const result = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(result).toEqual({ error: "Wax Rivals is already being monitored." })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("blocks a monitored brand matched case-insensitively by name", async () => {
    // Same brand under a different domain — the lower(name) arm of the OR hits.
    mockMonitoredFindFirst.mockResolvedValue({
      brandId: "wr",
      name: "WAX RIVALS",
      domain: "waxrivals.net",
    })

    const result = await submitBrandRequest(
      null,
      makeFormData({ ...VALID_FORM, brandName: "wax rivals" }),
    )

    expect(result).toEqual({ error: "WAX RIVALS is already being monitored." })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("blocks a duplicate of a pending request", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("recon_running"))

    const result = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(result).toEqual({
      error: "This brand has already been requested and is pending review.",
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("allows resubmission after a rejection (rejected rows are filtered out)", async () => {
    // The action's `ne(status, 'rejected')` filter means the dedupe lookup finds
    // nothing even though a rejected row exists for this brand.
    mockRequestFindFirst.mockResolvedValue(undefined)

    const result = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(result).toEqual({ success: true })
    expect(insertValues).toHaveBeenCalled()
  })

  it("inserts the normalized row and dispatches brand-recon", async () => {
    const result = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(result).toEqual({ success: true })
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: "Wax Rivals",
        websiteUrl: "https://www.waxrivals.com",
        normalizedDomain: "waxrivals.com",
        note: VALID_FORM.note,
        knownCityState: "Austin, TX",
        submittedBy: "user-1",
      }),
    )

    const inserted = insertValues.mock.calls[0][0] as Record<string, unknown>
    expect(typeof inserted.id).toBe("string")
    expect(inserted.updatedAt).toBeInstanceOf(Date)

    // The dispatch payload carries the id we generated for the row.
    expect(mockDispatch).toHaveBeenCalledWith("brand-recon", inserted.id)
  })

  it("stores empty optional fields as null", async () => {
    await submitBrandRequest(
      null,
      makeFormData({ brandName: "Wax Rivals", websiteUrl: "waxrivals.com" }),
    )

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ note: null, knownCityState: null }),
    )
  })

  it("still succeeds when the recon dispatch fails, recording the reason", async () => {
    mockDispatch.mockResolvedValue({ ok: false, error: "Bad credentials" })

    const result = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(result).toEqual({ success: true })
    expect(updateSetCalls).toHaveLength(1)
    expect(updateSetCalls[0]).toMatchObject({
      error: "Recon dispatch failed: Bad credentials",
    })
  })

  it("throttles a franchisee after 5 submissions in the window", async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await submitBrandRequest(null, makeFormData(VALID_FORM))
      expect(ok).toEqual({ success: true })
    }

    const blocked = await submitBrandRequest(null, makeFormData(VALID_FORM))

    expect(blocked).toEqual({
      error: "Too many requests. Please try again in a minute.",
    })
  })
})

describe("approveBrandRequest", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("rejects a non-admin caller without touching the row", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "user" } })

    await expect(approveBrandRequest("req-1")).rejects.toThrow(/Unauthorized/)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("throws when the request does not exist", async () => {
    mockRequestFindFirst.mockResolvedValue(undefined)

    await expect(approveBrandRequest("req-1")).rejects.toThrow("Request not found")
  })

  it("refuses to approve before recon completes", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("submitted"))

    await expect(approveBrandRequest("req-1")).rejects.toThrow(
      "Recon has not completed yet. Wait for the cost estimate or approve without recon.",
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("approves a recon_complete request and dispatches brand-build", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("recon_complete"))

    const result = await approveBrandRequest("req-1")

    expect(result).toEqual({ success: true, dispatched: true })
    expect(updateSetCalls[0]).toMatchObject({
      status: "approved",
      decidedBy: "admin-1",
      rejectReason: null,
    })
    expect(updateSetCalls[0].decidedAt).toBeInstanceOf(Date)
    expect(updateSetCalls[0].updatedAt).toBeInstanceOf(Date)
    expect(mockDispatch).toHaveBeenCalledWith("brand-build", "req-1")
  })

  it("approves a submitted request with the withoutRecon override", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("submitted"))

    const result = await approveBrandRequest("req-1", { withoutRecon: true })

    expect(result).toEqual({ success: true, dispatched: true })
    expect(updateSetCalls[0]).toMatchObject({ status: "approved" })
  })

  it("approves a needs_human request with the withoutRecon override", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("needs_human"))

    await expect(
      approveBrandRequest("req-1", { withoutRecon: true }),
    ).resolves.toMatchObject({ success: true })
  })

  it("throws when the request is already approved", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("approved"))

    await expect(approveBrandRequest("req-1")).rejects.toThrow(
      "Request is already approved.",
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("throws when the build is already running", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("building"))

    await expect(approveBrandRequest("req-1", { withoutRecon: true })).rejects.toThrow(
      "Request is already approved.",
    )
  })

  it("throws when the request was rejected", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("rejected"))

    await expect(approveBrandRequest("req-1")).rejects.toThrow(
      "Request was rejected. The franchisee can submit it again.",
    )
  })

  it("keeps the approval when the build dispatch fails", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("recon_complete"))
    mockDispatch.mockResolvedValue({ ok: false, error: "Not Found" })

    const result = await approveBrandRequest("req-1")

    expect(result).toEqual({ success: true, dispatched: false })
    expect(updateSetCalls[0]).toMatchObject({ status: "approved" })
    expect(updateSetCalls[1]).toMatchObject({
      error: "Build dispatch failed: Not Found",
    })
  })
})

describe("rejectBrandRequest", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    mockRequestFindFirst.mockResolvedValue(requestRow("recon_complete"))
  })

  it("rejects a non-admin caller", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "user" } })

    await expect(rejectBrandRequest("req-1", "Too small")).rejects.toThrow(
      /Unauthorized/,
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("requires a reason", async () => {
    await expect(rejectBrandRequest("req-1", "   ")).rejects.toThrow(
      "A rejection reason is required.",
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("caps the reason length", async () => {
    await expect(rejectBrandRequest("req-1", "x".repeat(501))).rejects.toThrow(
      "Keep the rejection reason under 500 characters.",
    )
  })

  it("throws when the request does not exist", async () => {
    mockRequestFindFirst.mockResolvedValue(undefined)

    await expect(rejectBrandRequest("req-1", "Too small")).rejects.toThrow(
      "Request not found",
    )
  })

  it("records the decision on the happy path", async () => {
    const result = await rejectBrandRequest("req-1", "  Only 3 locations nationwide  ")

    expect(result).toEqual({ success: true })
    expect(updateSetCalls[0]).toMatchObject({
      status: "rejected",
      rejectReason: "Only 3 locations nationwide",
      decidedBy: "admin-1",
    })
    expect(updateSetCalls[0].decidedAt).toBeInstanceOf(Date)
    expect(updateSetCalls[0].updatedAt).toBeInstanceOf(Date)
  })

  it("throws when the request is already rejected", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("rejected"))

    await expect(rejectBrandRequest("req-1", "Too small")).rejects.toThrow(
      "Request is already rejected.",
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("throws when the request is already approved", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("approved"))

    await expect(rejectBrandRequest("req-1", "Changed my mind")).rejects.toThrow(
      "Request is already approved and being set up — it can no longer be rejected.",
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe("retryMonitorDispatch", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
  })

  it("rejects a non-admin caller", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", role: "user" } })

    await expect(retryMonitorDispatch("req-1", "recon")).rejects.toThrow(/Unauthorized/)
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("throws when the request does not exist", async () => {
    mockRequestFindFirst.mockResolvedValue(undefined)

    await expect(retryMonitorDispatch("req-1", "recon")).rejects.toThrow(
      "Request not found",
    )
  })

  it("refuses a recon retry once the pipeline has moved on", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("live"))

    await expect(retryMonitorDispatch("req-1", "recon")).rejects.toThrow(
      'Cannot retry recon dispatch from status "live".',
    )
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("refuses a build retry before approval", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("recon_complete"))

    await expect(retryMonitorDispatch("req-1", "build")).rejects.toThrow(
      'Cannot retry build dispatch from status "recon_complete".',
    )
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it("re-fires recon and clears the stale error", async () => {
    mockRequestFindFirst.mockResolvedValue(
      requestRow("submitted", { error: "Recon dispatch failed: Bad credentials" }),
    )

    const result = await retryMonitorDispatch("req-1", "recon")

    expect(result).toEqual({ success: true })
    expect(mockDispatch).toHaveBeenCalledWith("brand-recon", "req-1")
    expect(updateSetCalls).toHaveLength(1)
    expect(updateSetCalls[0]).toMatchObject({ error: null })
  })

  it("re-fires build from the approved state", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("approved"))

    await expect(retryMonitorDispatch("req-1", "build")).resolves.toEqual({
      success: true,
    })
    expect(mockDispatch).toHaveBeenCalledWith("brand-build", "req-1")
  })

  it("throws and records the reason when the retry also fails", async () => {
    mockRequestFindFirst.mockResolvedValue(requestRow("approved"))
    mockDispatch.mockResolvedValue({ ok: false, error: "Bad credentials" })

    await expect(retryMonitorDispatch("req-1", "build")).rejects.toThrow(
      "Dispatch failed: Bad credentials",
    )
    expect(updateSetCalls[0]).toMatchObject({
      error: "Dispatch failed: Bad credentials",
    })
  })
})
