'use client'

import type { AnnotatedCompetitor } from "@/lib/competitor-sort"
import { isNewClosure } from "@/lib/closure-recency"
import { SaveCompetitorButton } from "./SaveCompetitorButton"

interface CompetitorListProps {
  competitors: AnnotatedCompetitor[]
  savedSet: Set<string>
  onToggleSave: (c: AnnotatedCompetitor) => void
  onSelect: (c: AnnotatedCompetitor) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}

function statusLabel(status: string): string {
  if (status === "CLOSED_PERMANENTLY") return "Permanently Closed"
  if (status === "CLOSED_TEMPORARILY") return "Temporarily Closed"
  return status
}

export function CompetitorList({
  competitors,
  savedSet,
  onToggleSave,
  onSelect,
  hoveredId,
  onHover,
}: CompetitorListProps) {
  if (competitors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-500 text-lg mb-2">No competitor locations</p>
        <p className="text-gray-400 text-sm">Closures appear here when the monitor finds them.</p>
      </div>
    )
  }

  // One reading per render so every card in the list agrees on "now".
  const now = new Date()

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">{competitors.length} competitor location{competitors.length !== 1 ? "s" : ""}</p>
      <div className="grid grid-cols-1 gap-3">
        {competitors.map((c) => {
          const permanent = c.businessStatus === "CLOSED_PERMANENTLY"
          const isHovered = hoveredId === c.googlePlaceId
          const place = [c.city, c.state].filter(Boolean).join(", ")
          const isNew = isNewClosure(c.closedAt, now)
          return (
            <div
              key={c.googlePlaceId}
              onMouseEnter={() => onHover(c.googlePlaceId)}
              onMouseLeave={() => onHover(null)}
              className={`flex gap-3 p-4 bg-white rounded-xl border transition-all duration-200 ${
                isHovered ? "border-gray-300 shadow-md" : "border-gray-200"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(c)}
                aria-label={`Show ${c.brandName} on map`}
                className="flex-1 min-w-0 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2 rounded-lg"
              >
                {isNew && (
                  <span className="mb-1 mr-1 inline-flex items-center gap-1 rounded-full bg-amber-700 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
                      <path d="M12 2l2.9 6.26L21.5 9l-4.75 4.64L18 21l-6-3.27L6 21l1.25-7.36L2.5 9l6.6-.74L12 2z" />
                    </svg>
                    New
                  </span>
                )}
                {c.isOpportunity && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full mb-1">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
                      <path d="M12 2l2.9 6.26L21.5 9l-4.75 4.64L18 21l-6-3.27L6 21l1.25-7.36L2.5 9l6.6-.74L12 2z" />
                    </svg>
                    Opportunity
                  </span>
                )}
                <p className="text-sm font-bold text-gray-900 truncate">{c.brandName}</p>
                <span
                  className="inline-block text-xs font-semibold px-2 py-0.5 rounded-full mt-1"
                  style={{
                    backgroundColor: permanent ? "var(--hs-red-100)" : "var(--color-warning-light)",
                    color: permanent ? "var(--color-error)" : "var(--color-warning)",
                  }}
                >
                  {statusLabel(c.businessStatus)}
                </span>
                <p className="text-xs text-gray-500 mt-1 truncate">
                  {c.address}{place ? ` · ${place}` : ""}
                </p>
                {c.ownerDistanceMiles != null && c.ownerDistanceFrom ? (
                  <p className="text-xs text-hs-taupe mt-1">
                    ≈{c.ownerDistanceMiles.toFixed(1)} mi from {c.ownerDistanceFrom}
                  </p>
                ) : c.nearestHsName && c.nearestHsMiles != null ? (
                  <p className="text-xs text-hs-taupe mt-1">
                    {c.nearestHsMiles.toFixed(1)} mi from {c.nearestHsName}
                  </p>
                ) : null}
              </button>
              <div className="flex items-start">
                <SaveCompetitorButton
                  saved={savedSet.has(c.googlePlaceId)}
                  onToggle={() => onToggleSave(c)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
