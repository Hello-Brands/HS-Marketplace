// src/__tests__/geocode/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// The route now enforces a session (defense-in-depth); mock an authenticated
// user so the proxy behavior under test runs. A dedicated case below covers the
// unauthenticated 401 path.
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }))
vi.mock("@/auth", () => ({ auth: mockAuth }))

import { GET } from "@/app/api/geocode/[...q]/route"

const OLD_KEY = process.env.MAPTILER_API_KEY

beforeEach(() => {
  mockAuth.mockResolvedValue({ user: { id: "u1", role: "user" } })
})

afterEach(() => {
  process.env.MAPTILER_API_KEY = OLD_KEY
  vi.restoreAllMocks()
})

describe("GET /api/geocode/[...q]", () => {
  it("returns 401 when there is no session", async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(new Request("http://localhost/api/geocode/Boise.json"), {
      params: Promise.resolve({ q: ["Boise.json"] }),
    })
    expect(res.status).toBe(401)
  })

  it("returns 503 when the server key is missing", async () => {
    delete process.env.MAPTILER_API_KEY
    const res = await GET(new Request("http://localhost/api/geocode/Boise.json"), {
      params: Promise.resolve({ q: ["Boise.json"] }),
    })
    expect(res.status).toBe(503)
  })

  it("forwards to MapTiler with the server key, ignoring the client key", async () => {
    process.env.MAPTILER_API_KEY = "SERVER"
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      new Request("http://localhost/api/geocode/Boise.json?country=us&key=CLIENT"),
      { params: Promise.resolve({ q: ["Boise.json"] }) }
    )

    expect(res.status).toBe(200)
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain("api.maptiler.com/geocoding/Boise.json")
    expect(calledUrl).toContain("key=SERVER")
    expect(calledUrl).not.toContain("CLIENT")
  })

  it("returns 502 when the upstream fetch throws", async () => {
    process.env.MAPTILER_API_KEY = "SERVER"
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network") }))
    const res = await GET(new Request("http://localhost/api/geocode/Boise.json"), {
      params: Promise.resolve({ q: ["Boise.json"] }),
    })
    expect(res.status).toBe(502)
  })
})
