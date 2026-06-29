import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockInsert, mockUpdate, valuesFn, setWhere } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  valuesFn: vi.fn(),
  setWhere: vi.fn(),
}))

vi.mock("@/db", () => ({ db: { insert: mockInsert, update: mockUpdate } }))

import { recordLogin } from "@/lib/analytics/logins"

beforeEach(() => {
  vi.clearAllMocks()
  mockInsert.mockReturnValue({ values: valuesFn.mockResolvedValue(undefined) })
  mockUpdate.mockReturnValue({ set: () => ({ where: setWhere.mockResolvedValue(undefined) }) })
})

it("inserts a login event and bumps the user's counters", async () => {
  await recordLogin("user-7")
  expect(mockInsert).toHaveBeenCalled()
  expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-7" }))
  expect(mockUpdate).toHaveBeenCalled()
  expect(setWhere).toHaveBeenCalled()
})

it("no-ops without a userId", async () => {
  await recordLogin("")
  expect(mockInsert).not.toHaveBeenCalled()
})
