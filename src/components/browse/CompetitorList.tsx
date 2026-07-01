'use client'

import type { CompetitorClosure } from "@/lib/competitor-query"
import { SaveCompetitorButton } from "./SaveCompetitorButton"

interface CompetitorListProps {
  competitors: CompetitorClosure[]
  savedSet: Set<string>
  onToggleSave: (c: CompetitorClosure) => void
  onSelect: (c: CompetitorClosure) => void
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

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">{competitors.length} competitor location{competitors.length !== 1 ? "s" : ""}</p>
      <div className="grid grid-cols-1 gap-3">
        {competitors.map((c) => {
          const permanent = c.businessStatus === "CLOSED_PERMANENTLY"
          const isHovered = hoveredId === c.googlePlaceId
          const place = [c.city, c.state].filter(Boolean).join(", ")
          return (
            <div
              key={c.googlePlaceId}
              role="button"
              tabIndex={0}
              aria-label={`Show ${c.brandName} on map`}
              onMouseEnter={() => onHover(c.googlePlaceId)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelect(c)
                }
              }}
              className={`flex gap-3 p-4 bg-white rounded-xl border cursor-pointer transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2 ${
                isHovered ? "border-gray-300 shadow-md" : "border-gray-200"
              }`}
            >
              <div className="flex-1 min-w-0">
                {c.isOpportunity && (
                  <span className="inline-block text-[10px] font-bold uppercase tracking-wide bg-[#F3E4D0] text-[#B9772E] px-2 py-0.5 rounded-full mb-1">
                    ★ Opportunity
                  </span>
                )}
                <p className="text-sm font-bold text-gray-900 truncate">{c.brandName}</p>
                <span
                  className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1"
                  style={{
                    backgroundColor: permanent ? "#F7DCDA" : "#F3E4D0",
                    color: permanent ? "#C0142F" : "#B9772E",
                  }}
                >
                  {statusLabel(c.businessStatus)}
                </span>
                <p className="text-xs text-gray-500 mt-1 truncate">
                  {c.address}{place ? ` · ${place}` : ""}
                </p>
                {c.nearestHsName && c.nearestHsMiles != null && (
                  <p className="text-xs text-[#8F7067] mt-1">
                    {c.nearestHsMiles.toFixed(1)} mi from {c.nearestHsName}
                  </p>
                )}
              </div>
              <div className="flex items-start" onClick={(e) => e.stopPropagation()}>
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
