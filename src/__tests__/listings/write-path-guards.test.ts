import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAuth, mockSelect, mockUpdate, setWhere, mockFindFirst } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  setWhere: vi.fn(),
  mockFindFirst: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/email", () => ({ sendStatusChangeEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/alert-actions", () => ({ triggerAlertMatching: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    update: mockUpdate,
    query: {
      listings: { findFirst: mockFindFirst },
    },
  },
}))

import { saveDraft } from "@/lib/listings/actions"
import { adminUpdateListing } from "@/lib/admin/actions"

// ─── DEBT-001: adminUpdateListing money fields must be stored in cents ───────

describe("adminUpdateListing money conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })
    const setFn = vi.fn(() => ({ where: setWhere }))
    mockUpdate.mockReturnValue({ set: setFn })
    // Existing row: $200,000 asking price / $80,000 TTM profit, stored in cents.
    mockFindFirst.mockResolvedValue({
      id: "L1",
      sellerId: "seller-1",
      title: "Existing Salon",
      askingPrice: 20_000_000,
      ttmProfit: 8_000_000,
      inventoryIncluded: false,
      laserIncluded: false,
    })
  })

  it("converts askingPrice and ttmProfit from dollars to cents", async () => {
    // The edit form works in dollars (pages seed it with askingPrice / 100).
    await adminUpdateListing("L1", { askingPrice: 500_000, ttmProfit: 120_000 })

    const payload = mockUpdate.mock.results[0].value.set.mock.calls[0][0]
    expect(payload.askingPrice).toBe(50_000_000)
    expect(payload.ttmProfit).toBe(12_000_000)
  })

  it("keeps existing money values on a partial edit", async () => {
    await adminUpdateListing("L1", { notes: "admin note only" })

    const payload = mockUpdate.mock.results[0].value.set.mock.calls[0][0]
    expect(payload.askingPrice).toBe(20_000_000)
    expect(payload.ttmProfit).toBe(8_000_000)
  })
})

// ─── DEBT-002: saveDraft update branch must enforce ownership ─────────────────

describe("saveDraft ownership guard", () => {
  const victimListing = {
    id: "victim-1",
    sellerId: "other-seller",
    status: "draft",
  }
  const ownListing = {
    id: "mine-1",
    sellerId: "seller-1",
    status: "draft",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    const setFn = vi.fn(() => ({ where: setWhere }))
    mockUpdate.mockReturnValue({ set: setFn })
  })

  it("rejects updating a listing owned by another seller", async () => {
    mockAuth.mockResolvedValue({ user: { id: "seller-1", role: "user", sellerAccess: true } })
    mockSelect.mockResolvedValue([victimListing])

    await expect(saveDraft({ askingPrice: 1 }, "victim-1")).rejects.toThrow("Not authorized")
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("rejects updating a listing that does not exist", async () => {
    mockAuth.mockResolvedValue({ user: { id: "seller-1", role: "user", sellerAccess: true } })
    mockSelect.mockResolvedValue([])

    await expect(saveDraft({ askingPrice: 1 }, "ghost-1")).rejects.toThrow("Listing not found")
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("allows the owner to update their own draft", async () => {
    mockAuth.mockResolvedValue({ user: { id: "seller-1", role: "user", sellerAccess: true } })
    mockSelect.mockResolvedValue([ownListing])

    const result = await saveDraft({ askingPrice: 100_000 }, "mine-1")
    expect(result).toEqual({ success: true, listingId: "mine-1" })
    expect(mockUpdate).toHaveBeenCalled()
  })

  it("allows an admin to update another seller's draft", async () => {
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin", sellerAccess: false } })
    mockSelect.mockResolvedValue([victimListing])

    const result = await saveDraft({ askingPrice: 100_000 }, "victim-1")
    expect(result).toEqual({ success: true, listingId: "victim-1" })
    expect(mockUpdate).toHaveBeenCalled()
  })
})
