"use client"

import { useState } from "react"
import { useListingFilters } from "./FilterBar"

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full border border-white"
      style={{ backgroundColor: color, boxShadow: "0 0 0 1px rgba(0,0,0,.08)" }}
    />
  )
}

function Diamond({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] border border-white"
      style={{ backgroundColor: color, boxShadow: "0 0 0 1px rgba(0,0,0,.08)" }}
    />
  )
}

function DiamondHollow() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-white"
      style={{ border: "1.5px solid var(--hs-taupe)" }}
    />
  )
}

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function ToggleRow({
  label,
  active,
  onClick,
  swatch,
}: {
  label: string
  active: boolean
  onClick: () => void
  swatch?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? `Hide ${label.toLowerCase()} on the map` : `Show ${label.toLowerCase()} on the map`}
      className={`group -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium transition-colors
        hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-1
        ${active ? "text-gray-800" : "text-gray-300"}`}
    >
      {swatch ? <span className="flex w-4 justify-center">{swatch}</span> : <span className="w-4" />}
      <span className={`flex-1 ${active ? "" : "line-through"}`}>{label}</span>
      <span className={`transition-colors ${active ? "text-gray-300 group-hover:text-gray-500" : "text-gray-300"}`}>
        <EyeIcon off={!active} />
      </span>
    </button>
  )
}

/** Collapsible on-map key: 4 swatches, 3 rows that toggle their map layer. */
export function MapLegend() {
  const [filters, setFilters] = useListingFilters()
  const [collapsed, setCollapsed] = useState(false)
  const compActive = filters.showCompetitors

  return (
    <div className="absolute bottom-3 left-3 z-10 w-52 rounded-xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500"
      >
        Map key
        <svg
          className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3">
          <p className="pb-1.5 text-[10px] leading-snug text-gray-400">
            Click a row to show or hide it on the map
          </p>
          <ToggleRow
            label="For sale"
            active={filters.showListings}
            onClick={() => setFilters({ showListings: !filters.showListings })}
            swatch={<Dot color="var(--hs-red-600)" />}
          />
          <ToggleRow
            label="Hello Sugar (not listed)"
            active={filters.showHsLocations}
            onClick={() => setFilters({ showHsLocations: !filters.showHsLocations })}
            swatch={<Dot color="var(--hs-taupe)" />}
          />

          <div className="mt-1.5 border-t border-gray-100 pt-1.5">
            <ToggleRow
              label="Competitors"
              active={compActive}
              onClick={() => setFilters({ showCompetitors: !filters.showCompetitors })}
            />
            <div className={`flex items-center gap-2 py-0.5 pl-6 text-xs ${compActive ? "text-gray-500" : "text-gray-300"}`}>
              <Diamond color="var(--color-warning)" />
              <span>Opportunity</span>
            </div>
            <div className={`flex items-center gap-2 py-0.5 pl-6 text-xs ${compActive ? "text-gray-500" : "text-gray-300"}`}>
              <DiamondHollow />
              <span>Closed</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
