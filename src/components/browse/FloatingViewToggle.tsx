"use client"

import type { ViewMode } from "@/lib/view-mode"

// Zillow-style floating pill, bottom-center over the map or list (mobile
// only). Map view shows a single "List" action; list view shows "Map | Sort".
// Parent container must be `relative`; the browse main already reserves
// tab-bar clearance (pb-tabbar), so bottom-4 sits above the tab bar.

interface FloatingViewToggleProps {
  viewMode: ViewMode
  onViewChange: (mode: ViewMode) => void
  onSortClick: () => void
}

const BTN =
  "flex items-center gap-2 px-4 min-h-[44px] text-sm font-bold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"

export function FloatingViewToggle({ viewMode, onViewChange, onSortClick }: FloatingViewToggleProps) {
  return (
    <div className="md:hidden absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex overflow-hidden rounded-full border border-gray-200 bg-white shadow-lg">
      {viewMode === "map" ? (
        <button type="button" onClick={() => onViewChange("list")} className={BTN}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          List
        </button>
      ) : (
        <>
          <button type="button" onClick={() => onViewChange("map")} className={BTN}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Map
          </button>
          <span className="my-2 w-px bg-gray-200" aria-hidden="true" />
          <button type="button" onClick={onSortClick} className={BTN}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h5m8-8v12m0 0l-4-4m4 4l4-4" />
            </svg>
            Sort
          </button>
        </>
      )}
    </div>
  )
}
