import { describe, it, expect, beforeEach } from "vitest"
import { checkRateLimit, __resetRateLimits } from "@/lib/rate-limit"

describe("checkRateLimit (sliding window)", () => {
  beforeEach(() => __resetRateLimits())

  it("allows up to the limit within the window, then blocks", () => {
    const key = "k1"
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 1000, 1000 + i).allowed).toBe(true)
    }
    const blocked = checkRateLimit(key, 3, 1000, 1003)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it("allows again once the window slides past old hits", () => {
    const key = "k2"
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 1000, 1000 + i)
    // Blocked while the three hits are still inside the 1000ms window.
    expect(checkRateLimit(key, 3, 1000, 1500).allowed).toBe(false)
    // After the window fully passes the earliest hits, calls are allowed again.
    expect(checkRateLimit(key, 3, 1000, 2500).allowed).toBe(true)
  })

  it("keys are independent", () => {
    expect(checkRateLimit("a", 1, 1000, 1000).allowed).toBe(true)
    expect(checkRateLimit("a", 1, 1000, 1000).allowed).toBe(false)
    // Different key is unaffected.
    expect(checkRateLimit("b", 1, 1000, 1000).allowed).toBe(true)
  })

  it("reports retryAfterMs as time until the oldest in-window hit expires", () => {
    const key = "k3"
    checkRateLimit(key, 1, 1000, 1000)
    const blocked = checkRateLimit(key, 1, 1000, 1200)
    // oldest hit at 1000 + window 1000 = expires at 2000; now 1200 -> 800ms.
    expect(blocked.retryAfterMs).toBe(800)
  })
})
