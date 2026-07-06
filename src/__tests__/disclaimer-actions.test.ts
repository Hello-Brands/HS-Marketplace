import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAuth, mockInsert, valuesCalls, valuesImpl } = vi.hoisted(() => {
  const valuesCalls: Record<string, unknown>[] = []
  const valuesImpl = { current: (_v: Record<string, unknown>) => Promise.resolve() as Promise<unknown> }
  return {
    mockAuth: vi.fn(),
    valuesCalls,
    valuesImpl,
    mockInsert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        valuesCalls.push(v)
        return valuesImpl.current(v)
      },
    })),
  }
})

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({ db: { insert: mockInsert } }))

import { acknowledgeSellingDisclaimer, FDD_VERSION } from "@/lib/listings/disclaimer-actions"

beforeEach(() => {
  vi.clearAllMocks()
  valuesCalls.length = 0
  valuesImpl.current = () => Promise.resolve()
})

describe("FDD_VERSION", () => {
  it("is the expected version string", () => {
    expect(FDD_VERSION).toBe("2026")
  })
})

describe("acknowledgeSellingDisclaimer", () => {
  it("inserts one row for the authenticated user and returns ok", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    const result = await acknowledgeSellingDisclaimer()
    expect(result).toEqual({ ok: true })
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(valuesCalls).toHaveLength(1)
    expect(valuesCalls[0]).toMatchObject({ userId: "user-1", fddVersion: "2026" })
  })

  it("throws and does not insert when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(acknowledgeSellingDisclaimer()).rejects.toThrow()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("propagates a DB insert error (so the caller can withhold the wizard)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    valuesImpl.current = () => Promise.reject(new Error("db down"))
    await expect(acknowledgeSellingDisclaimer()).rejects.toThrow("db down")
  })
})
