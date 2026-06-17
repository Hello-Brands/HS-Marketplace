import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// client.ts starts with `import "server-only"`, which throws in node tests unless mocked.
vi.mock("server-only", () => ({}))

describe("boulevard client", () => {
  const env = process.env
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...env, BOULEVARD_API_URL: "https://blvd.test/admin", BOULEVARD_API_KEY: "k" }
  })
  afterEach(() => { process.env = env; vi.restoreAllMocks() })

  it("returns null when creds are missing", async () => {
    process.env = { ...env }
    delete process.env.BOULEVARD_API_URL
    const { fetchMonthlySales } = await import("@/lib/boulevard/client")
    expect(await fetchMonthlySales("b1", 12)).toBeNull()
  })

  it("returns null when the API errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const { fetchMonthlySales } = await import("@/lib/boulevard/client")
    expect(await fetchMonthlySales("b1", 12)).toBeNull()
  })

  it("parses monthly sales (cents) from a valid response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { location: { monthlySales: [
        { month: "2026-05", salesCents: 4500000 },
      ] } } }),
    })
    const { fetchMonthlySales } = await import("@/lib/boulevard/client")
    const r = await fetchMonthlySales("b1", 12)
    expect(r).toEqual([{ month: "2026-05", sales: 4500000 }])
  })
})
