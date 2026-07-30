import "server-only"
import { env } from "@/lib/env"

/**
 * GitHub `repository_dispatch` bridge to the external `competitor-monitor` repo.
 *
 * The brand-request lifecycle is split across two systems: this app owns the
 * rows and the admin decision, the monitor repo owns recon + build. We hand off
 * by firing a repository_dispatch event carrying only the request id; the
 * workflow reads the row over its own DB connection and writes progress back
 * (see src/db/schema/brandRequests.ts header).
 *
 * NEVER THROWS. A failed dispatch must not roll back a submission or an
 * approval — the row is the source of truth and admins retry from the request
 * detail view (see retryMonitorDispatch). Callers record the reason in the
 * row's `error` column so the failure is visible in the queue.
 */

const DISPATCH_URL =
  "https://api.github.com/repos/Hello-Brands/competitor-monitor/dispatches"

export type MonitorEventType = "brand-recon" | "brand-build"

export async function dispatchMonitorEvent(
  eventType: MonitorEventType,
  requestId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = env.GITHUB_DISPATCH_TOKEN
  if (!token) {
    const error = "GITHUB_DISPATCH_TOKEN is not configured"
    console.error("[brand-requests] dispatch failed", eventType, requestId, error)
    return { ok: false, error }
  }

  try {
    const res = await fetch(DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: eventType,
        client_payload: { request_id: requestId },
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    })

    // GitHub answers 204 No Content on success; accept any 2xx defensively.
    if (res.ok) return { ok: true }

    // Body is short JSON on errors ("Bad credentials", "Not Found"). Truncate so
    // an HTML error page can't bloat the row's `error` column.
    const body = await res.text().catch(() => "")
    const error = `GitHub dispatch returned ${res.status}${
      body ? `: ${body.slice(0, 300)}` : ""
    }`
    console.error("[brand-requests] dispatch failed", eventType, requestId, error)
    return { ok: false, error }
  } catch (err) {
    // Network failure or the 10s AbortSignal.timeout firing.
    const error = err instanceof Error ? err.message : String(err)
    console.error("[brand-requests] dispatch failed", eventType, requestId, error)
    return { ok: false, error }
  }
}
