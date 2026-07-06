// Lightweight in-process rate limiter (DEBT-028).
//
// IMPORTANT — best-effort only. On Vercel Fluid Compute this state lives in a
// single function instance: it is not shared across instances and resets on cold
// start. It meaningfully throttles a single hot-looping caller hitting one warm
// instance, but it is NOT a durable or distributed guarantee. A production-grade
// limit needs a shared store (Upstash / Vercel KV) or a platform control
// (Vercel BotID / Firewall rate rules). This is a deliberate interim mitigation
// for endpoints that spend money or send email.
//
// Sliding-window log: per key we keep the timestamps of recent hits, drop those
// older than the window, and allow the call only if fewer than `limit` remain.

const hitsByKey = new Map<string, number[]>()

export interface RateLimitResult {
  allowed: boolean
  /** Milliseconds until the caller may retry (only set when blocked). */
  retryAfterMs?: number
}

/**
 * Record and evaluate a call against a per-key sliding window.
 * `now` is injectable for testing.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - windowMs
  const recent = (hitsByKey.get(key) ?? []).filter((t) => t > cutoff)

  if (recent.length >= limit) {
    // Oldest hit in the window frees a slot once it ages out.
    const retryAfterMs = recent[0] + windowMs - now
    hitsByKey.set(key, recent)
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) }
  }

  recent.push(now)
  hitsByKey.set(key, recent)
  return { allowed: true }
}

/** Test-only: clear all recorded state. */
export function __resetRateLimits() {
  hitsByKey.clear()
}
