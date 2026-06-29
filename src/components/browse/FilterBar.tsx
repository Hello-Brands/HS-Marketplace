"use client"

import { useState } from "react"
import { parseAsArrayOf, parseAsFloat, parseAsInteger, parseAsString, useQueryStates } from "nuqs"
import { US_STATES } from "@/lib/us-states"
import { FilterPopover } from "./FilterPopover"

// Radius range (miles) for the location search slider.
export const RADIUS_MIN_MILES = 1
export const RADIUS_MAX_MILES = 100
export const DEFAULT_RADIUS_MILES = 25

const LISTING_TYPES = [
  { label: "Suite", value: "suite" },
  { label: "Flagship", value: "flagship" },
  { label: "Territory", value: "territory" },
  { label: "Bundle", value: "bundle" },
]

const SORT_OPTIONS = [
  { label: "Newest first", value: "newest" },
  { label: "Price: Low to high", value: "price-asc" },
  { label: "Price: High to low", value: "price-desc" },
  // Only selectable when a search location is set (see render below).
  { label: "Nearest first", value: "distance", requiresCenter: true },
]

const TIME_OPEN_OPTIONS = [
  { label: "Any", value: 0 },
  { label: "1+ years", value: 1 },
  { label: "2+ years", value: 2 },
  { label: "3+ years", value: 3 },
  { label: "5+ years", value: 5 },
]

export function useListingFilters() {
  return useQueryStates({
    query: parseAsString.withDefault(""),
    types: parseAsArrayOf(parseAsString).withDefault([]),
    states: parseAsArrayOf(parseAsString).withDefault([]),
    // Stored in cents (matches listings.asking_price); the Price control
    // converts to/from whole dollars for entry/display.
    minPrice: parseAsInteger,
    maxPrice: parseAsInteger,
    sort: parseAsString.withDefault("newest"),
    minYearsOpen: parseAsInteger,
    // Radius search (set together when a location is picked)
    centerLat: parseAsFloat,
    centerLng: parseAsFloat,
    radiusMiles: parseAsInteger,
    centerLabel: parseAsString.withDefault(""),
  })
}

// ---- Price helpers (URL stores cents; users enter whole dollars) ----------
function fmtShortPrice(cents: number): string {
  const d = cents / 100
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`
  if (d >= 1_000) return `$${Math.round(d / 1_000)}k`
  return `$${d}`
}
function priceSummary(minCents: number | null, maxCents: number | null): string | null {
  if (minCents != null && maxCents != null) return `${fmtShortPrice(minCents)}–${fmtShortPrice(maxCents)}`
  if (minCents != null) return `${fmtShortPrice(minCents)}+`
  if (maxCents != null) return `≤${fmtShortPrice(maxCents)}`
  return null
}

export function FilterBar() {
  const [filters, setFilters] = useListingFilters()

  const hasActiveFilters =
    !!filters.query ||
    filters.types.length > 0 ||
    filters.states.length > 0 ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    (filters.minYearsOpen !== null && filters.minYearsOpen > 0) ||
    filters.centerLat !== null

  function toggleType(value: string) {
    const current = filters.types
    const updated = current.includes(value)
      ? current.filter((t) => t !== value)
      : [...current, value]
    setFilters({ types: updated })
  }

  function toggleState(value: string) {
    const current = filters.states
    const updated = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value]
    setFilters({ states: updated })
  }

  function clearAll() {
    setFilters(
      {
        query: null,
        types: [],
        states: [],
        minPrice: null,
        maxPrice: null,
        sort: "newest",
        minYearsOpen: null,
        centerLat: null,
        centerLng: null,
        radiusMiles: null,
        centerLabel: null,
      },
      // Non-shallow so a cleared location also refreshes the server-rendered
      // map pins (the map is fed the server's initial list).
      { shallow: false }
    )
  }

  const yearsSummary =
    filters.minYearsOpen && filters.minYearsOpen > 0 ? `${filters.minYearsOpen}+ yr` : null

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Text search */}
          <div className="relative">
            <svg
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              aria-label="Search by city or location"
              value={filters.query}
              onChange={(e) => setFilters({ query: e.target.value || null })}
              placeholder="Search by city or location…"
              className="
                h-11 w-56 rounded-full border border-gray-300 bg-white pl-10 pr-4 text-sm text-gray-800
                transition-all duration-200 ease-out placeholder:text-gray-400
                hover:border-gray-400
                focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500
              "
            />
          </div>

          <div className="hidden sm:block h-7 w-px bg-gray-200" />

          {/* Type — kept as direct-click pills */}
          <div className="flex gap-1.5">
            {LISTING_TYPES.map((type) => {
              const isActive = filters.types.includes(type.value)
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => toggleType(type.value)}
                  aria-pressed={isActive}
                  className={`
                    h-11 px-4 rounded-full text-sm font-medium border
                    transition-all duration-200 ease-out
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-1
                    ${
                      isActive
                        ? "bg-hs-red-600 border-hs-red-600 text-white shadow-sm"
                        : "bg-white border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                    }
                  `}
                >
                  {type.label}
                </button>
              )
            })}
          </div>

          {/* State — multi-select dropdown */}
          <FilterPopover
            label="State"
            active={filters.states.length > 0}
            summary={filters.states.length > 0 ? String(filters.states.length) : null}
          >
            {() => (
              <StatePanel
                selected={filters.states}
                onToggle={toggleState}
                onClear={() => setFilters({ states: [] })}
              />
            )}
          </FilterPopover>

          {/* Price — free numeric entry */}
          <FilterPopover
            label="Price"
            active={filters.minPrice !== null || filters.maxPrice !== null}
            summary={priceSummary(filters.minPrice, filters.maxPrice)}
          >
            {(close) => (
              <PricePanel
                minCents={filters.minPrice}
                maxCents={filters.maxPrice}
                onApply={(minCents, maxCents) => setFilters({ minPrice: minCents, maxPrice: maxCents })}
                close={close}
              />
            )}
          </FilterPopover>

          {/* Years open */}
          <FilterPopover
            label="Years Open"
            active={!!yearsSummary}
            summary={yearsSummary}
          >
            {(close) => (
              <div className="min-w-[200px]">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                  Minimum years open
                </h4>
                {TIME_OPEN_OPTIONS.map((o) => {
                  const checked = (filters.minYearsOpen ?? 0) === o.value
                  return (
                    <label
                      key={o.value}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm"
                    >
                      <input
                        type="radio"
                        name="years-open"
                        checked={checked}
                        onChange={() => {
                          setFilters({ minYearsOpen: o.value || null })
                          close()
                        }}
                        className="w-4 h-4 accent-hs-red-600"
                      />
                      {o.label}
                    </label>
                  )
                })}
              </div>
            )}
          </FilterPopover>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Sort — labelled so it reads as sorting, not filtering */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">Sort</span>
            <div className="relative">
              <select
                aria-label="Sort listings"
                value={filters.sort}
                onChange={(e) => setFilters({ sort: e.target.value })}
                className="
                  h-11 appearance-none rounded-full border border-gray-300 bg-white pl-4 pr-9 text-sm font-medium text-gray-700
                  transition-all duration-200 ease-out hover:border-gray-400
                  focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500
                "
              >
                {SORT_OPTIONS.filter((o) => !o.requiresCenter || filters.centerLat !== null).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>

          {/* Clear all */}
          <button
            onClick={clearAll}
            className={`
              text-sm font-semibold text-hs-red-600 hover:text-hs-red-700
              px-3 py-2 rounded-lg transition-all duration-200 ease-out hover:bg-hs-red-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
              ${hasActiveFilters ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2 pointer-events-none"}
            `}
            tabIndex={hasActiveFilters ? 0 : -1}
            aria-hidden={!hasActiveFilters}
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- State dropdown panel --------------------------------------------------
function StatePanel({
  selected,
  onToggle,
  onClear,
}: {
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  const [q, setQ] = useState("")
  const filtered = US_STATES.filter((s) => s.label.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="w-[300px]">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search states…"
        className="
          w-full h-9 rounded-lg border border-gray-300 px-3 text-sm mb-2
          focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500
        "
      />
      <div className="max-h-[240px] overflow-y-auto grid grid-cols-2 gap-0.5 pr-0.5">
        {filtered.map((s) => {
          const checked = selected.includes(s.value)
          return (
            <label
              key={s.value}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer text-sm"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(s.value)}
                className="w-4 h-4 accent-hs-red-600 shrink-0"
              />
              <span className="truncate">{s.label}</span>
            </label>
          )
        })}
        {filtered.length === 0 && (
          <p className="col-span-2 text-sm text-gray-400 px-2 py-3 text-center">No matches</p>
        )}
      </div>
      <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-gray-100">
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700"
        >
          Clear
        </button>
        <span className="text-xs text-gray-400 tabular-nums">{selected.length} selected</span>
      </div>
    </div>
  )
}

// ---- Price entry panel -----------------------------------------------------
function PricePanel({
  minCents,
  maxCents,
  onApply,
  close,
}: {
  minCents: number | null
  maxCents: number | null
  onApply: (minCents: number | null, maxCents: number | null) => void
  close: () => void
}) {
  // Drafts hold whole-dollar digit strings; committed to cents on Apply.
  const [min, setMin] = useState(minCents != null ? String(Math.round(minCents / 100)) : "")
  const [max, setMax] = useState(maxCents != null ? String(Math.round(maxCents / 100)) : "")

  const toCents = (v: string) => {
    const digits = v.replace(/[^0-9]/g, "")
    return digits ? Number(digits) * 100 : null
  }
  const apply = () => {
    onApply(toCents(min), toCents(max))
    close()
  }
  const clear = () => {
    setMin("")
    setMax("")
    onApply(null, null)
    close()
  }

  return (
    <div className="min-w-[260px]">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">Price range</h4>
      <div className="flex items-center gap-2">
        <PriceInput value={min} onChange={setMin} placeholder="Min" onEnter={apply} />
        <span className="text-gray-400">–</span>
        <PriceInput value={max} onChange={setMax} placeholder="Max" onEnter={apply} />
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <button
          type="button"
          onClick={clear}
          className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={apply}
          className="px-3.5 py-1.5 rounded-lg bg-hs-red-600 text-white text-xs font-semibold hover:bg-hs-red-700"
        >
          Apply
        </button>
      </div>
    </div>
  )
}

function PriceInput({
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onEnter: () => void
}) {
  // Show grouped thousands while keeping the stored value as raw digits.
  const display = value ? Number(value).toLocaleString("en-US") : ""
  return (
    <div className="relative flex-1">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEnter()
        }}
        placeholder={placeholder}
        className="
          w-full h-10 rounded-lg border border-gray-300 pl-6 pr-2 text-sm text-gray-800 tabular-nums
          focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500
        "
      />
    </div>
  )
}
