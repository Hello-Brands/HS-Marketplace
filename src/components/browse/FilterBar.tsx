"use client"

import { parseAsArrayOf, parseAsFloat, parseAsInteger, parseAsString, useQueryStates } from "nuqs"
import { US_STATES } from "@/lib/us-states"

// Radius range (miles) for the location search slider.
export const RADIUS_MIN_MILES = 1
export const RADIUS_MAX_MILES = 100
export const DEFAULT_RADIUS_MILES = 25

const PRICE_OPTIONS = [
  { label: "Any", value: undefined },
  { label: "$100k", value: 100_000 },
  { label: "$250k", value: 250_000 },
  { label: "$500k", value: 500_000 },
  { label: "$1M", value: 1_000_000 },
  { label: "$2M+", value: 2_000_000 },
]

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

  const selectBaseClass = `
    text-sm border border-gray-300 rounded-lg px-3 py-2
    bg-white text-gray-700
    transition-all duration-200 ease-out
    focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500
    hover:border-gray-400
    min-h-[44px]
  `

  return (
    <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="flex items-center gap-2">
            <label htmlFor="filter-search" className="text-sm font-semibold text-gray-900">
              Search
            </label>
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                id="filter-search"
                type="text"
                value={filters.query}
                onChange={(e) => setFilters({ query: e.target.value || null })}
                placeholder="City, location..."
                className="
                  text-sm border border-gray-300 rounded-lg pl-9 pr-3 py-2 w-44
                  transition-all duration-200 ease-out
                  focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500
                  hover:border-gray-400
                  placeholder:text-gray-400
                  min-h-[44px]
                "
              />
            </div>
          </div>

          {/* Vertical divider */}
          <div className="hidden sm:block h-8 w-px bg-gray-200" />

          {/* Type filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900">Type</span>
            <div className="flex gap-1.5">
              {LISTING_TYPES.map((type) => {
                const isActive = filters.types.includes(type.value)
                return (
                  <button
                    key={type.value}
                    onClick={() => toggleType(type.value)}
                    className={`
                      px-3 py-2 text-sm font-medium rounded-lg
                      transition-all duration-200 ease-out
                      min-h-[44px]
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                      ${
                        isActive
                          ? "bg-hs-red-600 text-white shadow-sm"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }
                    `}
                  >
                    {type.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Vertical divider */}
          <div className="hidden sm:block h-8 w-px bg-gray-200" />

          {/* State filter */}
          <div className="flex items-center gap-2">
            <label htmlFor="filter-states" className="text-sm font-semibold text-gray-900">
              State
            </label>
            <div className="relative flex items-center">
              <select
                id="filter-states"
                multiple
                value={filters.states}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions).map((o) => o.value)
                  setFilters({ states: selected })
                }}
                className={`${selectBaseClass} h-9 min-w-[100px]`}
                title="Hold Ctrl/Cmd to select multiple states"
              >
                {US_STATES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {filters.states.length > 0 && (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 bg-hs-red-100 text-hs-red-700 text-xs font-semibold rounded-full">
                  {filters.states.length}
                </span>
              )}
            </div>
          </div>

          {/* Vertical divider */}
          <div className="hidden sm:block h-8 w-px bg-gray-200" />

          {/* Price range */}
          <div className="flex items-center gap-2">
            <label htmlFor="filter-min-price" className="text-sm font-semibold text-gray-900">
              Price
            </label>
            <select
              id="filter-min-price"
              value={filters.minPrice ?? ""}
              onChange={(e) =>
                setFilters({ minPrice: e.target.value ? Number(e.target.value) : null })
              }
              className={selectBaseClass}
            >
              <option value="">Min</option>
              {PRICE_OPTIONS.filter((o) => o.value !== undefined).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-gray-400">–</span>
            <select
              id="filter-max-price"
              aria-label="Maximum price"
              value={filters.maxPrice ?? ""}
              onChange={(e) =>
                setFilters({ maxPrice: e.target.value ? Number(e.target.value) : null })
              }
              className={selectBaseClass}
            >
              <option value="">Max</option>
              {PRICE_OPTIONS.filter((o) => o.value !== undefined).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Vertical divider */}
          <div className="hidden lg:block h-8 w-px bg-gray-200" />

          {/* Time open */}
          <div className="flex items-center gap-2">
            <label htmlFor="filter-years-open" className="text-sm font-semibold text-gray-900">
              Years Open
            </label>
            <select
              id="filter-years-open"
              value={filters.minYearsOpen ?? 0}
              onChange={(e) => setFilters({ minYearsOpen: Number(e.target.value) || null })}
              className={selectBaseClass}
            >
              {TIME_OPEN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Sort */}
          <div className="flex items-center gap-2">
            <label htmlFor="filter-sort" className="text-sm font-semibold text-gray-900">
              Sort
            </label>
            <select
              id="filter-sort"
              value={filters.sort}
              onChange={(e) => setFilters({ sort: e.target.value })}
              className={selectBaseClass}
            >
              {SORT_OPTIONS.filter((o) => !o.requiresCenter || filters.centerLat !== null).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Clear all */}
          <button
            onClick={clearAll}
            className={`
              text-sm font-semibold text-hs-red-600
              hover:text-hs-red-700
              px-3 py-2
              rounded-lg
              transition-all duration-200 ease-out
              hover:bg-hs-red-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
              min-h-[44px]
              ${hasActiveFilters ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2 pointer-events-none'}
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
