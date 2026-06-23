"use client"

import type { KpiMetric } from "@/lib/kpi/schema"
import type { KpiBadge } from "@/lib/kpi/badges"

interface KpiCardProps {
  name: string
  metric: KpiMetric
  formatValue: (value: number) => string
  onClick: () => void
  badge: KpiBadge
}

export function KpiCard({ name, metric, formatValue, onClick, badge }: KpiCardProps) {
  return (
    <button
      onClick={onClick}
      className="relative min-h-[120px] rounded-lg border border-gray-200 bg-white p-4 shadow-sm cursor-pointer hover:border-hs-red-300 hover:shadow-md transition-all text-left w-full focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
    >
      {/* Data-source badge - top right */}
      <div className={`absolute top-3 right-3 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
        badge === "live" ? "bg-green-600 text-white"
        : badge === "pending" ? "bg-amber-100 text-amber-700"
        : "bg-gray-200 text-gray-600"
      }`}>
        {badge === "live" && (
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
          </svg>
        )}
        <span>{badge === "live" ? "Live" : badge === "pending" ? "Pending" : "Sample"}</span>
      </div>

      {/* Metric Name */}
      <p className="text-xs font-normal text-gray-500 uppercase tracking-wide mb-1">{name}</p>

      {/* Primary Value */}
      <p className="text-3xl font-semibold text-gray-900 mb-2">{formatValue(metric.lastMonth)}</p>

      {/* MoM Change */}
      <p className="text-sm text-gray-600 mb-2">{formatMomChange(metric.momChange)}</p>

      {/* Freshness Timestamp */}
      <p className="text-xs text-gray-400">{formatRelativeTime(metric.updatedAt)}</p>
    </button>
  )
}

/**
 * Format MoM change as arrow + percentage.
 * Positive: up arrow +12%, Negative: down arrow -3%, Zero: right arrow 0%
 */
function formatMomChange(change: number): string {
  const percentage = Math.abs(change * 100).toFixed(0)

  if (change > 0) {
    return `\u2191 +${percentage}%` // up arrow
  } else if (change < 0) {
    return `\u2193 -${percentage}%` // down arrow
  } else {
    return `\u2192 0%` // right arrow
  }
}

/**
 * Format ISO datetime as relative time (e.g., "Updated 2 hours ago").
 */
function formatRelativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diffMs / 60_000)

  if (mins < 1) {
    return "Updated just now"
  }
  if (mins < 60) {
    return `Updated ${mins} minute${mins !== 1 ? "s" : ""} ago`
  }

  const hrs = Math.floor(mins / 60)
  return `Updated ${hrs} hour${hrs !== 1 ? "s" : ""} ago`
}
