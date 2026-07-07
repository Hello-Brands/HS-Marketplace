"use client"

import { useState } from "react"
import { parseAsArrayOf, parseAsBoolean, parseAsFloat, parseAsInteger, parseAsString, useQueryStates } from "nuqs"
import { US_STATES } from "@/lib/us-states"
import { FilterPopover } from "./FilterPopover"
import { LocationSearch } from "./LocationSearchDynamic"

// Radius range (miles) for the location search slider.
export const RADIUS_MIN_MILES = 1
export const RADIUS_MAX_MILES = 100
export const DEFAULT_RADIUS_MILES = 25

// Bundle is intentionally absent from the filter UI (still valid in the DB).
const LISTING_TYPES = [
  { label: "Suite", value: "suite" },
  { label: "Flagship", value: "flagship" },
  { label: "Territory", value: "territory" },
]

const SORT_OPTIONS = [
  { label: "Newest first", value: "newest" },
  { label: "Price: Low to high", value: "price-asc" },
  { label: "Price: High to low", value: "price-desc" },
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
    minPrice: parseAsInteger,
    maxPrice: parseAsInteger,
    sort: parseAsString.withDefault("newest"),
    minYearsOpen: parseAsInteger,
    inventoryIncluded: parseAsBoolean.withDefault(false),
    centerLat: parseAsFloat,
    centerLng: parseAsFloat,
    radiusMiles: parseAsInteger,
    centerLabel: parseAsString.withDefault(""),
    showListings: parseAsBoolean.withDefault(true),
    showCompetitors: parseAsBoolean.withDefault(true),
    showHsLocations: parseAsBoolean.withDefault(true),
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

interface FilterBarProps {
  onLocationSelect: (location: { lng: number; lat: number; name: string }) => void
}

export function FilterBar({ onLocationSelect }: FilterBarProps) {
  const [filters, setFilters] = useListingFilters()

  const hasActiveFilters =
    !!filters.query ||
    filters.types.length > 0 ||
    filters.states.length > 0 ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    (filters.minYearsOpen !== null && filters.minYearsOpen > 0) ||
    filters.inventoryIncluded ||
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
        inventoryIncluded: false,
        centerLat: null,
        centerLng: null,
        radiusMiles: null,
        centerLabel: null,
      },
      { shallow: false }
    )
  }

  // Count of active filters living inside the "Filters" dropdown.
  const filtersCount =
    (filters.query ? 1 : 0) +
    (filters.states.length > 0 ? 1 : 0) +
    (filters.minYearsOpen && filters.minYearsOpen > 0 ? 1 : 0) +
    (filters.inventoryIncluded ? 1 : 0)

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Prominent geographic search (desktop bar; mobile uses the second-row copy) */}
          <div className="hidden md:block flex-1 max-w-[520px]">
            <LocationSearch onSelect={onLocationSelect} variant="prominent" />
          </div>

          {/* Listing Type — multi-select dropdown */}
          <FilterPopover
            label="Listing Type"
            active={filters.types.length > 0}
            summary={filters.types.length > 0 ? String(filters.types.length) : null}
          >
            {() => (
              <ListingTypePanel
                selected={filters.types}
                onToggle={toggleType}
                onClear={() => setFilters({ types: [] })}
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

          {/* Filters — keyword + state + years open + inventory */}
          <FilterPopover
            label="Filters"
            active={filtersCount > 0}
            summary={filtersCount > 0 ? String(filtersCount) : null}
            panelClassName="w-[300px]"
          >
            {(close) => (
              <FiltersPanel
                query={filters.query}
                states={filters.states}
                minYearsOpen={filters.minYearsOpen}
                inventoryIncluded={filters.inventoryIncluded}
                onQueryChange={(v) => setFilters({ query: v || null })}
                onToggleState={toggleState}
                onClearStates={() => setFilters({ states: [] })}
                onYearsChange={(v) => setFilters({ minYearsOpen: v || null })}
                onInventoryChange={(v) => setFilters({ inventoryIncluded: v })}
                onClearAll={() =>
                  setFilters({ query: null, states: [], minYearsOpen: null, inventoryIncluded: false })
                }
                close={close}
              />
            )}
          </FilterPopover>

          {/* Spacer pushes Sort to the right */}
          <div className="flex-1" />

          {/* Sort */}
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
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
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

// ---- Listing Type multi-select panel --------------------------------------
function ListingTypePanel({
  selected, onToggle, onClear,
}: {
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  return (
    <div className="min-w-[200px] max-w-[calc(100vw-2rem)]">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Listing type</h4>
      {LISTING_TYPES.map((t) => {
        const checked = selected.includes(t.value)
        return (
          <label
            key={t.value}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm"
          >
            <input type="checkbox" checked={checked} onChange={() => onToggle(t.value)} className="w-4 h-4 accent-hs-red-600" />
            {t.label}
          </label>
        )
      })}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <button type="button" onClick={onClear} className="inline-flex items-center min-h-[36px] px-3 -ml-3 text-xs font-semibold text-hs-red-600 hover:text-hs-red-700">
          Clear
        </button>
        <span className="text-xs text-gray-400 tabular-nums">{selected.length} selected</span>
      </div>
    </div>
  )
}

// ---- Filters dropdown panel (keyword + state + years + inventory) ----------
function FiltersPanel({
  query, states, minYearsOpen, inventoryIncluded,
  onQueryChange, onToggleState, onClearStates, onYearsChange, onInventoryChange, onClearAll, close,
}: {
  query: string
  states: string[]
  minYearsOpen: number | null
  inventoryIncluded: boolean
  onQueryChange: (v: string) => void
  onToggleState: (value: string) => void
  onClearStates: () => void
  onYearsChange: (v: number) => void
  onInventoryChange: (v: boolean) => void
  onClearAll: () => void
  close: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Keyword */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Keyword</h4>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Salon name, city, notes…"
          className="w-full h-9 rounded-lg border border-gray-300 px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
        />
      </div>

      {/* State */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">State</h4>
        <StatePanel selected={states} onToggle={onToggleState} onClear={onClearStates} />
      </div>

      {/* Years open */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Minimum years open</h4>
        {TIME_OPEN_OPTIONS.map((o) => {
          const checked = (minYearsOpen ?? 0) === o.value
          return (
            <label key={o.value} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
              <input
                type="radio"
                name="years-open"
                checked={checked}
                onChange={() => onYearsChange(o.value)}
                className="w-4 h-4 accent-hs-red-600"
              />
              {o.label}
            </label>
          )
        })}
      </div>

      {/* Inventory */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Inventory</h4>
        <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={inventoryIncluded}
            onChange={(e) => onInventoryChange(e.target.checked)}
            className="w-4 h-4 accent-hs-red-600"
          />
          Inventory included only
        </label>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <button type="button" onClick={onClearAll} className="inline-flex items-center min-h-[36px] px-3 -ml-3 text-xs font-semibold text-hs-red-600 hover:text-hs-red-700">
          Clear
        </button>
        <button
          type="button"
          onClick={close}
          className="inline-flex items-center justify-center min-h-[36px] px-3.5 py-1.5 rounded-lg bg-hs-red-600 text-white text-xs font-semibold hover:bg-hs-red-700"
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ---- State dropdown panel (unchanged) -------------------------------------
function StatePanel({
  selected, onToggle, onClear,
}: {
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  const [q, setQ] = useState("")
  const filtered = US_STATES.filter((s) => s.label.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="w-full">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search states…"
        className="w-full h-9 rounded-lg border border-gray-300 px-3 text-base sm:text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
      />
      <div className="max-h-[200px] overflow-y-auto grid grid-cols-2 gap-0.5 pr-0.5">
        {filtered.map((s) => {
          const checked = selected.includes(s.value)
          return (
            <label key={s.value} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
              <input type="checkbox" checked={checked} onChange={() => onToggle(s.value)} className="w-4 h-4 accent-hs-red-600 shrink-0" />
              <span className="truncate">{s.label}</span>
            </label>
          )
        })}
        {filtered.length === 0 && (
          <p className="col-span-2 text-sm text-gray-400 px-2 py-3 text-center">No matches</p>
        )}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <button type="button" onClick={onClear} className="inline-flex items-center min-h-[36px] px-3 -ml-3 text-xs font-semibold text-hs-red-600 hover:text-hs-red-700">
          Clear
        </button>
        <span className="text-xs text-gray-400 tabular-nums">{selected.length} selected</span>
      </div>
    </div>
  )
}

// ---- Price entry panel (unchanged) ----------------------------------------
function PricePanel({
  minCents, maxCents, onApply, close,
}: {
  minCents: number | null
  maxCents: number | null
  onApply: (minCents: number | null, maxCents: number | null) => void
  close: () => void
}) {
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
    <div className="min-w-[260px] max-w-[calc(100vw-2rem)]">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">Price range</h4>
      <div className="flex items-center gap-2">
        <PriceInput value={min} onChange={setMin} placeholder="Min" onEnter={apply} />
        <span className="text-gray-400">–</span>
        <PriceInput value={max} onChange={setMax} placeholder="Max" onEnter={apply} />
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <button type="button" onClick={clear} className="inline-flex items-center min-h-[36px] px-3 -ml-3 text-xs font-semibold text-hs-red-600 hover:text-hs-red-700">
          Clear
        </button>
        <button type="button" onClick={apply} className="inline-flex items-center justify-center min-h-[36px] px-3.5 py-1.5 rounded-lg bg-hs-red-600 text-white text-xs font-semibold hover:bg-hs-red-700">
          Apply
        </button>
      </div>
    </div>
  )
}

function PriceInput({
  value, onChange, placeholder, onEnter,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onEnter: () => void
}) {
  const display = value ? Number(value).toLocaleString("en-US") : ""
  return (
    <div className="relative flex-1">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter() }}
        placeholder={placeholder}
        className="w-full h-10 rounded-lg border border-gray-300 pl-6 pr-2 text-base sm:text-sm text-gray-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
      />
    </div>
  )
}

