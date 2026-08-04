import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  mockAuth,
  mockSelect,
  mockUpdate,
  setWhere,
  mockFindFirst,
  mockSelectAdmin,
  mockFindMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  setWhere: vi.fn(),
  mockFindFirst: vi.fn(),
  mockSelectAdmin: vi.fn(),
  mockFindMany: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
// persist.ts re-derives ttmRevenue/mcr from BigQuery instead of trusting the
// client payload; stub the cached maps so write-path tests stay offline.
vi.mock("@/lib/bigquery/queries", () => ({
  getNetSalesByLocation: vi.fn().mockResolvedValue(new Map()),
  getMcrByLocation: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock("@/lib/email", () => ({ sendStatusChangeEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/alerts/matching", () => ({ triggerAlertMatching: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    update: mockUpdate,
    query: {
      listings: { findFirst: mockFindFirst },
      listingLocations: { findMany: mockFindMany },
    },
  },
}))

import { changeListingStatus } from "@/lib/listings/actions"
import { approveListing } from "@/lib/admin/actions"

// ─── changeListingStatus ─────────────────────────────────────────────────────

describe("changeListingStatus listedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin", sellerAccess: true } })
    // db.update(...).set(...).where(...)
    const setFn = vi.fn(() => ({ where: setWhere }))
    mockUpdate.mockReturnValue({ set: setFn })
    ;(mockUpdate as unknown as { lastSet?: typeof setFn }).lastSet = setFn
  })

  it("stamps listedAt when activating a listing that has none", async () => {
    mockSelect.mockResolvedValue([
      { id: "L1", sellerId: "seller-9", status: "pending", listedAt: null },
    ])
    await changeListingStatus("L1", "active")
    const setFn = mockUpdate.mock.results[0].value.set
    const payload = setFn.mock.calls[0][0]
    expect(payload.status).toBe("active")
    expect(payload.listedAt).toBeInstanceOf(Date)
  })

  it("does not overwrite an existing listedAt", async () => {
    // Starting status is "pending" (not "delisted") because delisted → active is not a
    // legal transition in the status machine; pending → active is. The set-once invariant
    // is what's under test here, not the specific prior status.
    const original = new Date("2026-01-01T00:00:00Z")
    mockSelect.mockResolvedValue([
      { id: "L1", sellerId: "seller-9", status: "pending", listedAt: original },
    ])
    await changeListingStatus("L1", "active")
    const setFn = mockUpdate.mock.results[0].value.set
    expect(setFn.mock.calls[0][0].listedAt).toEqual(original)
  })
})

// ─── approveListing ───────────────────────────────────────────────────────────

describe("approveListing listedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Admin session required by requireAdmin()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    // db.update(...).set(...).where(...)
    const setFn = vi.fn(() => ({ where: setWhere }))
    mockUpdate.mockReturnValue({ set: setFn })
    // db.select().from().where() returns [] for the listingLocations data-mapping
    // check → unresolvedSalonLocations([]) returns [] → gate passes without throwing.
    mockSelect.mockResolvedValue([])
    // db.query.listingLocations.findMany returns [] for the triggerAlertMatching call
    // (triggerAlertMatching itself is mocked, so the empty array is fine).
    mockFindMany.mockResolvedValue([])
  })

  it("stamps listedAt when approving a listing that has none", async () => {
    // Listing has status "pending" (the normal first-go-live path) and listedAt null.
    // Seller has no email so the sendStatusChangeEmail branch is skipped entirely.
    mockFindFirst.mockResolvedValue({
      id: "L2",
      sellerId: "seller-7",
      status: "pending",
      type: "suite",
      title: "Test Salon",
      askingPrice: 100000,
      listedAt: null,
      seller: { id: "seller-7", name: "Jane", email: null },
    })

    await approveListing("L2")

    const setFn = mockUpdate.mock.results[0].value.set
    const payload = setFn.mock.calls[0][0]
    expect(payload.status).toBe("active")
    expect(payload.listedAt).toBeInstanceOf(Date)
  })

  it("does not overwrite an existing listedAt on re-approval", async () => {
    // Starting status is "pending" (re-submitted after a prior activation cycle).
    // listedAt already set — the set-once invariant must be preserved.
    const original = new Date("2026-03-15T00:00:00Z")
    mockFindFirst.mockResolvedValue({
      id: "L3",
      sellerId: "seller-8",
      status: "pending",
      type: "suite",
      title: "Another Salon",
      askingPrice: 200000,
      listedAt: original,
      seller: { id: "seller-8", name: "Bob", email: null },
    })

    await approveListing("L3")

    const setFn = mockUpdate.mock.results[0].value.set
    expect(setFn.mock.calls[0][0].listedAt).toEqual(original)
  })
})
