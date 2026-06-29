import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAuth, mockSelect, mockUpdate, setWhere } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  setWhere: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    update: mockUpdate,
  },
}))

import { changeListingStatus } from "@/lib/listings/actions"

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
    const original = new Date("2026-01-01T00:00:00Z")
    mockSelect.mockResolvedValue([
      { id: "L1", sellerId: "seller-9", status: "pending", listedAt: original },
    ])
    await changeListingStatus("L1", "active")
    const setFn = mockUpdate.mock.results[0].value.set
    expect(setFn.mock.calls[0][0].listedAt).toEqual(original)
  })
})
