import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAuth, mockSelect, mockInsert, mockUpdate, returningFn } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  returningFn: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    insert: mockInsert,
    update: mockUpdate,
  },
}))

import { recordListingView } from "@/lib/analytics/views"

beforeEach(() => {
  vi.clearAllMocks()
  // insert(...).values(...).onConflictDoNothing(...).returning() -> returningFn()
  mockInsert.mockReturnValue({
    values: () => ({ onConflictDoNothing: () => ({ returning: returningFn }) }),
  })
  mockUpdate.mockReturnValue({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) })
})

it("does nothing when unauthenticated", async () => {
  mockAuth.mockResolvedValue(null)
  await recordListingView("L1")
  expect(mockInsert).not.toHaveBeenCalled()
})

it("skips the listing's own seller", async () => {
  mockAuth.mockResolvedValue({ user: { id: "seller-1", role: "user" } })
  mockSelect.mockResolvedValue([{ sellerId: "seller-1" }])
  await recordListingView("L1")
  expect(mockInsert).not.toHaveBeenCalled()
})

it("inserts and increments viewCount for a new viewer-day", async () => {
  mockAuth.mockResolvedValue({ user: { id: "viewer-1", role: "user" } })
  mockSelect.mockResolvedValue([{ sellerId: "seller-1" }])
  returningFn.mockResolvedValue([{ id: "view-1" }]) // a row was inserted
  await recordListingView("L1")
  expect(mockInsert).toHaveBeenCalled()
  expect(mockUpdate).toHaveBeenCalled()
})

it("does not increment when the viewer-day already exists", async () => {
  mockAuth.mockResolvedValue({ user: { id: "viewer-1", role: "user" } })
  mockSelect.mockResolvedValue([{ sellerId: "seller-1" }])
  returningFn.mockResolvedValue([]) // conflict — nothing inserted
  await recordListingView("L1")
  expect(mockInsert).toHaveBeenCalled()
  expect(mockUpdate).not.toHaveBeenCalled()
})
