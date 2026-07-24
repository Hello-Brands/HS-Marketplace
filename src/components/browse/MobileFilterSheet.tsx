"use client"

import { useEffect, useState } from "react"
import { FullScreenSheet } from "@/components/ui"
import {
  useListingFilters,
  LISTING_TYPES,
  TIME_OPEN_OPTIONS,
  StatePanel,
  PriceInput,
  RADIUS_MIN_MILES,
  RADIUS_MAX_MILES,
  DEFAULT_RADIUS_MILES,
} from "./FilterBar"
import { LocationSearch } from "./LocationSearchDynamic"

// Purpose-built mobile filters: full-screen sheet with stacked sections
// (no popovers). Filters stay live-applied through the same nuqs state the
// desktop FilterBar uses — the footer button just closes the sheet. A true
// live result count isn't available client-side (listings paginate at 12),
// so the footer reads "Show results".

interface MobileFilterSheetProps {
  open: boolean
  onClose: () => void
  onLocationSelect: (location: { lng: number; lat: number; name: string }) => void
}

const SECTION = "border-b border-gray-100 pb-5 mb-5"
const SECTION_TITLE = "text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2"

export function MobileFilterSheet({ open, onClose, onLocationSelect }: MobileFilterSheetProps) {
  const [filters, setFilters] = useListingFilters()

  // Price entry is committed on blur/Enter (typing cents live would thrash the
  // URL); local text state mirrors the URL like the desktop PricePanel.
  const [minPriceText, setMinPriceText] = useState("")
  const [maxPriceText, setMaxPriceText] = useState("")
  // Live radius while dragging; committed on release like the desktop slider.
  const [draftRadius, setDraftRadius] = useState<number | null>(null)

  // Re-sync local text when the sheet opens (URL may have changed elsewhere).
  useEffect(() => {
    if (!open) return
    setMinPriceText(filters.minPrice != null ? String(Math.round(filters.minPrice / 100)) : "")
    setMaxPriceText(filters.maxPrice != null ? String(Math.round(filters.maxPrice / 100)) : "")
    setDraftRadius(null)
    // Intentionally only on open — the sheet owns the fields while visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toCents = (v: string) => {
    const digits = v.replace(/[^0-9]/g, "")
    return digits ? Number(digits) * 100 : null
  }
  const commitPrices = () =>
    setFilters({ minPrice: toCents(minPriceText), maxPrice: toCents(maxPriceText) })

  function toggleType(value: string) {
    const updated = filters.types.includes(value)
      ? filters.types.filter((t) => t !== value)
      : [...filters.types, value]
    setFilters({ types: updated })
  }

  function toggleState(value: string) {
    const updated = filters.states.includes(value)
      ? filters.states.filter((s) => s !== value)
      : [...filters.states, value]
    setFilters({ states: updated })
  }

  function clearAll() {
    setMinPriceText("")
    setMaxPriceText("")
    setFilters(
      {
        query: null,
        types: [],
        states: [],
        minPrice: null,
        maxPrice: null,
        sort: "newest",
        minYearsOpen: null,
        inventoryIncluded: false,
        centerLat: null,
        centerLng: null,
        radiusMiles: null,
        centerLabel: null,
      },
      { shallow: false }
    )
  }

  const hasCenter = filters.centerLat !== null && filters.centerLng !== null

  return (
    <FullScreenSheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 px-4 min-h-[44px] rounded-lg text-sm font-semibold text-hs-red-600 hover:bg-hs-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] rounded-xl bg-hs-red-600 text-white text-base font-bold hover:bg-hs-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            Show results
          </button>
        </div>
      }
    >
      {/* Location + radius */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Location</h3>
        <LocationSearch onSelect={onLocationSelect} />
        {hasCenter && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm font-medium text-gray-700">
              <span className="truncate">{filters.centerLabel || "Selected location"}</span>
              <span className="tabular-nums shrink-0">
                {draftRadius ?? filters.radiusMiles ?? DEFAULT_RADIUS_MILES} mi
              </span>
            </div>
            <input
              type="range"
              min={RADIUS_MIN_MILES}
              max={RADIUS_MAX_MILES}
              step={1}
              value={draftRadius ?? filters.radiusMiles ?? DEFAULT_RADIUS_MILES}
              onChange={(e) => setDraftRadius(Number(e.target.value))}
              onPointerUp={(e) => {
                setDraftRadius(null)
                setFilters({ radiusMiles: Number(e.currentTarget.value) }, { shallow: false })
              }}
              onKeyUp={(e) => {
                setDraftRadius(null)
                setFilters({ radiusMiles: Number(e.currentTarget.value) }, { shallow: false })
              }}
              aria-label="Search radius in miles"
              className="mt-1 w-full h-2 cursor-pointer accent-hs-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500/40 rounded-full"
            />
            <button
              type="button"
              onClick={() =>
                setFilters(
                  {
                    centerLat: null,
                    centerLng: null,
                    centerLabel: null,
                    radiusMiles: null,
                    sort: filters.sort === "distance" ? "newest" : filters.sort,
                  },
                  { shallow: false }
                )
              }
              className="mt-2 text-sm font-semibold text-hs-red-600 hover:text-hs-red-700 min-h-[44px]"
            >
              Clear location
            </button>
          </div>
        )}
      </div>

      {/* Listing type */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Listing type</h3>
        {LISTING_TYPES.map((t) => {
          const checked = filters.types.includes(t.value)
          return (
            <label key={t.value} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-base">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleType(t.value)}
                className="h-5 w-5 accent-hs-red-600"
              />
              {t.label}
            </label>
          )
        })}
      </div>

      {/* Price */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Price range</h3>
        <div className="flex items-center gap-2" onBlur={commitPrices}>
          <PriceInput value={minPriceText} onChange={setMinPriceText} placeholder="Min" onEnter={commitPrices} />
          <span className="text-gray-400">–</span>
          <PriceInput value={maxPriceText} onChange={setMaxPriceText} placeholder="Max" onEnter={commitPrices} />
        </div>
      </div>

      {/* Keyword */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Keyword</h3>
        <input
          type="text"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value || null })}
          placeholder="Salon name, city, notes…"
          className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-base focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
        />
      </div>

      {/* State */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>State</h3>
        <StatePanel
          selected={filters.states}
          onToggle={toggleState}
          onClear={() => setFilters({ states: [] })}
        />
      </div>

      {/* Years open */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Minimum years open</h3>
        {TIME_OPEN_OPTIONS.map((o) => {
          const checked = (filters.minYearsOpen ?? 0) === o.value
          return (
            <label key={o.value} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-base">
              <input
                type="radio"
                name="sheet-years-open"
                checked={checked}
                onChange={() => setFilters({ minYearsOpen: o.value || null })}
                className="h-5 w-5 accent-hs-red-600"
              />
              {o.label}
            </label>
          )
        })}
      </div>

      {/* Inventory */}
      <div className="pb-2">
        <h3 className={SECTION_TITLE}>Inventory</h3>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={filters.inventoryIncluded}
            onChange={(e) => setFilters({ inventoryIncluded: e.target.checked })}
            className="h-5 w-5 accent-hs-red-600"
          />
          Inventory included only
        </label>
      </div>
    </FullScreenSheet>
  )
}
