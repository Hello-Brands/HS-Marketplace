import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { dispatchMonitorEvent } from "@/lib/brand-requests/dispatch"

const DISPATCH_URL =
  "https://api.github.com/repos/Hello-Brands/competitor-monitor/dispatches"

describe("dispatchMonitorEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Failures always log; keep the suite output clean.
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "ghp_test_token")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("returns ok:false without calling fetch when the token is unset", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await dispatchMonitorEvent("brand-recon", "req-1")

    expect(result).toEqual({
      ok: false,
      error: "GITHUB_DISPATCH_TOKEN is not configured",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("treats GitHub's 204 as success and posts the documented request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204, text: async () => "" })
    vi.stubGlobal("fetch", fetchMock)

    const result = await dispatchMonitorEvent("brand-build", "req-42")

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(DISPATCH_URL)
    expect(init.method).toBe("POST")
    expect(init.cache).toBe("no-store")
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers).toEqual({
      Authorization: "Bearer ghp_test_token",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    })
    expect(JSON.parse(init.body)).toEqual({
      event_type: "brand-build",
      client_payload: { request_id: "req-42" },
    })
  })

  it("accepts any 2xx, not just 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }),
    )

    await expect(dispatchMonitorEvent("brand-recon", "req-2")).resolves.toEqual({
      ok: true,
    })
  })

  it("returns ok:false with the status and body snippet on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"message":"Bad credentials"}',
      }),
    )

    const result = await dispatchMonitorEvent("brand-recon", "req-3")

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error).toContain("401")
    expect(result.error).toContain("Bad credentials")
    expect(console.error).toHaveBeenCalled()
  })

  it("returns ok:false when the body cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error("stream closed")
        },
      }),
    )

    const result = await dispatchMonitorEvent("brand-build", "req-4")

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected failure")
    expect(result.error).toContain("500")
  })

  it("returns ok:false when fetch throws (network / timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("The operation timed out")))

    const result = await dispatchMonitorEvent("brand-recon", "req-5")

    expect(result).toEqual({ ok: false, error: "The operation timed out" })
    expect(console.error).toHaveBeenCalled()
  })

  it("never rejects, even on a non-Error throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        throw "boom"
      }),
    )

    const result = await dispatchMonitorEvent("brand-recon", "req-6")

    expect(result).toEqual({ ok: false, error: "boom" })
  })
})
