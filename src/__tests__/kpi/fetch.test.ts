import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock server-only to be a no-op in tests
vi.mock("server-only", () => ({}))

// Mock next/cache. fetch.ts wraps its fetcher in unstable_cache — make it a
// pass-through so tests exercise the uncached logic directly.
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))

// Mock the schema module so we can control safeParse behavior
vi.mock("@/lib/kpi/schema", () => ({
  kpiResponseSchema: {
    safeParse: vi.fn(),
  },
}))

describe("fetchLocationKpi", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      HS_INTERNAL_API_URL: "https://api.test.com",
      HS_INTERNAL_API_TOKEN: "test-token",
    }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it("returns null when fetch throws (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"))

    const { fetchLocationKpi } = await import("@/lib/kpi/fetch")
    const result = await fetchLocationKpi("loc-123")

    expect(result).toBeNull()
  })

  it("returns null when API returns non-200 status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    const { fetchLocationKpi } = await import("@/lib/kpi/fetch")
    const result = await fetchLocationKpi("loc-123")

    expect(result).toBeNull()
  })

  it("returns parsed KpiData when API returns valid response", async () => {
    const mockData = {
      revenue: {
        lastMonth: 45000,
        momChange: 0.12,
        trend: [],
        updatedAt: "2026-03-19T00:00:00Z",
      },
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { kpiResponseSchema } = await import("@/lib/kpi/schema")
    vi.mocked(kpiResponseSchema.safeParse).mockReturnValue({
      success: true,
      data: mockData,
    } as ReturnType<typeof kpiResponseSchema.safeParse>)

    const { fetchLocationKpi } = await import("@/lib/kpi/fetch")
    const result = await fetchLocationKpi("loc-123")

    expect(result).toEqual(mockData)
  })

  it("returns null when API response fails Zod validation", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invalid: "data" }),
    })

    const { kpiResponseSchema } = await import("@/lib/kpi/schema")
    vi.mocked(kpiResponseSchema.safeParse).mockReturnValue({
      success: false,
      error: { errors: [{ message: "Invalid" }] },
    } as ReturnType<typeof kpiResponseSchema.safeParse>)

    const { fetchLocationKpi } = await import("@/lib/kpi/fetch")
    const result = await fetchLocationKpi("loc-123")

    expect(result).toBeNull()
  })

  it("returns mock data when env vars are missing (dev fallback)", async () => {
    process.env = { ...originalEnv }
    delete process.env.HS_INTERNAL_API_URL
    delete process.env.HS_INTERNAL_API_TOKEN

    const { fetchLocationKpi } = await import("@/lib/kpi/fetch")
    // Import after resetModules so the instance matches fetch.ts's import.
    const { mockLocationKpi } = await import("@/lib/kpi/mock-data")
    const result = await fetchLocationKpi("loc-123")

    expect(result).toEqual(mockLocationKpi)
  })
})

describe("fetchBundleKpi", () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      HS_INTERNAL_API_URL: "https://api.test.com",
      HS_INTERNAL_API_TOKEN: "test-token",
    }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it("returns object with data for each successful locationId", async () => {
    const mockData = {
      revenue: {
        lastMonth: 45000,
        momChange: 0.12,
        trend: [],
        updatedAt: "2026-03-19T00:00:00Z",
      },
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    })

    const { kpiResponseSchema } = await import("@/lib/kpi/schema")
    vi.mocked(kpiResponseSchema.safeParse).mockReturnValue({
      success: true,
      data: mockData,
    } as ReturnType<typeof kpiResponseSchema.safeParse>)

    const { fetchBundleKpi } = await import("@/lib/kpi/fetch")
    const result = await fetchBundleKpi(["loc-1", "loc-2"])

    expect(result).toHaveProperty("loc-1")
    expect(result).toHaveProperty("loc-2")
  })

  it("excludes locations that returned null", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({ ok: false, status: 404 })

    const { kpiResponseSchema } = await import("@/lib/kpi/schema")
    vi
      .mocked(kpiResponseSchema.safeParse)
      .mockReturnValueOnce({
        success: true,
        data: {},
      } as ReturnType<typeof kpiResponseSchema.safeParse>)

    const { fetchBundleKpi } = await import("@/lib/kpi/fetch")
    const result = await fetchBundleKpi(["loc-1", "loc-2"])

    expect(result).toHaveProperty("loc-1")
    expect(result).not.toHaveProperty("loc-2")
  })
})
