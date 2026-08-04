"use client"

import { useState } from "react"
import { chooseOwnerAlerts } from "@/lib/owner-alerts/actions"

/**
 * One-time opt-in banner for owner closure alerts. Server code decides whether
 * to render it (shouldShowOwnerAlertsPrompt); either answer stamps the choice
 * and it never reappears.
 */
export function OwnerAlertsPrompt() {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<"enabled" | "declined" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(choice: "enabled" | "declined") {
    setBusy(true)
    setError(null)
    const result = await chooseOwnerAlerts(choice)
    setBusy(false)
    if (result.error) setError(result.error)
    else setDone(choice)
  }

  if (done === "declined") return null
  if (done === "enabled") {
    return (
      <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        Closure alerts are on. We&apos;ll email you when a competitor within 3 miles of one of
        your salons closes permanently — manage them under My Alerts.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-hs-red-200 bg-hs-red-50 p-4">
      <p className="text-sm font-semibold text-gray-900">
        Get notified when a competitor near one of your salons closes
      </p>
      <p className="text-sm text-gray-600 mt-1">
        We&apos;ll watch a 3-mile radius around each location you own and email you when a
        competitor permanently closes — a signal it may be time to expand or go flagship.
      </p>
      {error && <p className="text-xs text-hs-red-600 mt-2">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => choose("enabled")}
          disabled={busy}
          className="min-h-[40px] px-4 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 disabled:opacity-60"
        >
          {busy ? "Setting up..." : "Enable alerts"}
        </button>
        <button
          type="button"
          onClick={() => choose("declined")}
          disabled={busy}
          className="min-h-[40px] px-3 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          No thanks
        </button>
      </div>
    </div>
  )
}
