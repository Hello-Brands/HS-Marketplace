"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { FilterBar, useListingFilters, RADIUS_MIN_MILES, RADIUS_MAX_MILES, DEFAULT_RADIUS_MILES } from "./FilterBar"
import { MobileFilterDrawer } from "./MobileFilterDrawer"
import { ListingGrid } from "./ListingGrid"
import { CompetitorList } from "./CompetitorList"
import { LocationSearch } from "./LocationSearch"
import { RadiusSearchHint, shouldShowRadiusHint } from "./RadiusSearchHint"
import { SaveSearchButton } from "./SaveSearchButton"
import type { ListingCard } from "@/lib/listings-query"
import type { CompetitorClosure } from "@/lib/competitor-query"
import { useRouter } from "next/navigation"
import { competitorToSnapshot } from "@/lib/saved-competitors"
import { toggleSavedCompetitor } from "@/lib/saved-competitors-actions"

// Dynamic import for MapView avoids SSR issues with MapTiler SDK
const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-gray-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-hs-red-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-500 text-sm">Loading map...</span>
      </div>
    </div>
  ),
})

interface BrowsePageProps {
  initialListings: ListingCard[]
  competitorClosures?: CompetitorClosure[]
  favoriteIds?: string[]
  savedCompetitorIds?: string[]
}

export function BrowsePage({
  initialListings,
  competitorClosures = [],
  favoriteIds = [],
  savedCompetitorIds = [],
}: BrowsePageProps) {
  const [viewMode, setViewMode] = useState<"list" | "map">("map")
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  // Competitor-closure layer: visible by default, toggleable to declutter.
  const [showCompetitors, setShowCompetitors] = useState(true)
  // Which dataset the LEFT LIST shows. The map always shows both layers.
  const [listMode, setListMode] = useState<"listings" | "competitors">("listings")
  // Show/hide the Hello Sugar listing PIN layer on the map (independent of the
  // competitor layer toggle).
  const [showListings, setShowListings] = useState(true)
  // Saved competitor place ids, hydrated from the server and updated
  // optimistically. Shared by the list rows and the map popup so both reflect
  // the same state within the session.
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set(savedCompetitorIds))
  const opportunityCount = useMemo(
    () => competitorClosures.filter((c) => c.isOpportunity).length,
    [competitorClosures]
  )
  // Live slider value while dragging; committed to URL state (and a server
  // re-fetch) only on release so we don't fire a request per tick. null = idle.
  const [draftRadius, setDraftRadius] = useState<number | null>(null)

  const [rawFilters, setFilters] = useListingFilters()
  const router = useRouter()

  // Active search center (drives radius filtering, the map circle, and "X mi away").
  const searchCenter = useMemo(
    () =>
      rawFilters.centerLat !== null && rawFilters.centerLng !== null
        ? { lat: rawFilters.centerLat, lng: rawFilters.centerLng }
        : null,
    [rawFilters.centerLat, rawFilters.centerLng]
  )

  // nuqs returns null for unset parseAsInteger values; ListingFilters uses undefined
  const filters = {
    query: rawFilters.query || undefined,
    types: rawFilters.types,
    states: rawFilters.states,
    minPrice: rawFilters.minPrice ?? undefined,
    maxPrice: rawFilters.maxPrice ?? undefined,
    sort: rawFilters.sort as "newest" | "price-asc" | "price-desc" | "distance",
    minYearsOpen: rawFilters.minYearsOpen ?? undefined,
    centerLat: rawFilters.centerLat ?? undefined,
    centerLng: rawFilters.centerLng ?? undefined,
    radiusMiles: rawFilters.radiusMiles ?? undefined,
  }

  function handleLocationSelect(location: { lng: number; lat: number; name: string }) {
    // Set the search center (filters results) IN ADDITION to panning the map.
    // shallow:false re-runs the server fetch so the map pins reflect the radius.
    setFilters(
      {
        centerLat: location.lat,
        centerLng: location.lng,
        centerLabel: location.name,
        radiusMiles: rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES,
      },
      { shallow: false }
    )
    if (viewMode === "list") setViewMode("map")
  }

  function handleRadiusCommit(miles: number) {
    setDraftRadius(null)
    setFilters({ radiusMiles: miles }, { shallow: false })
  }

  function handleClearLocation() {
    setFilters(
      {
        centerLat: null,
        centerLng: null,
        centerLabel: null,
        radiusMiles: null,
        sort: rawFilters.sort === "distance" ? "newest" : rawFilters.sort,
      },
      { shallow: false }
    )
  }

  // Memoized so the MapView marker effect (which depends on it) doesn't rebuild
  // every render. router is a stable instance.
  const handleListingClick = useCallback(
    (id: string) => {
      router.push(`/listings/${id}`)
    },
    [router]
  )

  // Tracks competitor saves currently awaiting the server, keyed by placeId, so
  // a rapid re-click on the SAME competitor can't fire an out-of-order toggle
  // that leaves the DB disagreeing with the optimistic UI.
  const savingCompetitors = useRef<Set<string>>(new Set())

  // Optimistic save/unsave; reverts on error. Used by the list rows and map popup.
  const handleToggleSaveCompetitor = useCallback((c: CompetitorClosure) => {
    const placeId = c.googlePlaceId
    if (savingCompetitors.current.has(placeId)) return // a toggle for this competitor is in flight
    savingCompetitors.current.add(placeId)
    const wasSaved = savedSet.has(placeId)
    setSavedSet((prev) => {
      const next = new Set(prev)
      if (wasSaved) next.delete(placeId)
      else next.add(placeId)
      return next
    })
    toggleSavedCompetitor(competitorToSnapshot(c))
      .catch((err) => {
        console.error("Failed to toggle saved competitor", err)
        // revert on failure
        setSavedSet((prev) => {
          const next = new Set(prev)
          if (wasSaved) next.add(placeId)
          else next.delete(placeId)
          return next
        })
      })
      .finally(() => {
        savingCompetitors.current.delete(placeId)
      })
  }, [savedSet])

  // Stable array form for MapView (its marker effect keys off the joined ids).
  const savedCompetitorIdList = useMemo(() => Array.from(savedSet), [savedSet])

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Filter bar — desktop only, sticky at top */}
      <div className="hidden md:block">
        <FilterBar />
      </div>

      {/* View controls + mobile filter button */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Mobile: Filters button */}
          <button
            onClick={() => setMobileFiltersOpen(true)}
            className="md:hidden flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors min-h-[44px]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </button>

          {/* View toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden shadow-sm">
            <button
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              className={`
                px-4 py-2 text-sm font-semibold transition-all duration-200
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                ${
                  viewMode === "list"
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }
              `}
            >
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                List
              </span>
            </button>
            <button
              onClick={() => setViewMode("map")}
              aria-pressed={viewMode === "map"}
              className={`
                px-4 py-2 text-sm font-semibold transition-all duration-200 border-l border-gray-200
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                ${
                  viewMode === "map"
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }
              `}
            >
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                Map
              </span>
            </button>
          </div>

          {/* List dataset switch — only meaningful when the scraper has pushed
              at least one closure. Controls the LEFT LIST only; the map always
              shows both layers. */}
          {competitorClosures.length > 0 && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              <button
                onClick={() => setListMode("listings")}
                aria-pressed={listMode === "listings"}
                className={`px-4 py-2 text-sm font-semibold transition-all duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  ${listMode === "listings" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                Listings
              </button>
              <button
                onClick={() => setListMode("competitors")}
                aria-pressed={listMode === "competitors"}
                className={`px-4 py-2 text-sm font-semibold transition-all duration-200 border-l border-gray-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  ${listMode === "competitors" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                Competitors
              </button>
            </div>
          )}

          {/* Location search + radius + Save search */}
          <div className="flex w-full sm:w-auto sm:flex-1 items-center gap-3 justify-end order-last sm:order-none">
            <div className="max-w-sm flex-1">
              <LocationSearch onSelect={handleLocationSelect} />
            </div>

            {/* Radius control + active-location chip (only when a center is set) */}
            {searchCenter && (
              <div className="flex items-center gap-3">
                <label htmlFor="radius-slider" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                  Within
                </label>
                <input
                  id="radius-slider"
                  type="range"
                  min={RADIUS_MIN_MILES}
                  max={RADIUS_MAX_MILES}
                  step={1}
                  value={draftRadius ?? rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES}
                  // Live visual update while dragging (no fetch).
                  onChange={(e) => setDraftRadius(Number(e.target.value))}
                  // Commit (and re-fetch) only when the interaction ends.
                  onPointerUp={(e) => handleRadiusCommit(Number(e.currentTarget.value))}
                  onKeyUp={(e) => handleRadiusCommit(Number(e.currentTarget.value))}
                  aria-label="Search radius in miles"
                  className="
                    w-28 sm:w-32 h-2 cursor-pointer accent-hs-red-600
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500/40 rounded-full
                  "
                />
                <span className="text-sm font-medium text-gray-700 tabular-nums whitespace-nowrap w-12">
                  {draftRadius ?? rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES} mi
                </span>
                <button
                  type="button"
                  onClick={handleClearLocation}
                  title={`Clear location: ${rawFilters.centerLabel}`}
                  className="
                    inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] max-w-[220px]
                    text-sm font-medium text-hs-red-700 bg-hs-red-50 hover:bg-hs-red-100
                    rounded-lg transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  "
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="truncate">{rawFilters.centerLabel || "Location"}</span>
                </button>
              </div>
            )}

            <SaveSearchButton
              filters={{
                query: rawFilters.query || undefined,
                types: rawFilters.types,
                states: rawFilters.states,
                minPrice: rawFilters.minPrice,
                maxPrice: rawFilters.maxPrice,
                minYearsOpen: rawFilters.minYearsOpen,
                sort: rawFilters.sort,
                centerLat: rawFilters.centerLat,
                centerLng: rawFilters.centerLng,
                radiusMiles: rawFilters.radiusMiles,
                centerLabel: rawFilters.centerLabel || undefined,
              }}
            />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1">
        {viewMode === "list" ? (
          /* List view — full width grid */
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {listMode === "competitors" ? (
              <CompetitorList
                competitors={competitorClosures}
                savedSet={savedSet}
                onToggleSave={handleToggleSaveCompetitor}
                hoveredId={hoveredId}
                onHover={setHoveredId}
              />
            ) : (
              <ListingGrid
                initialListings={initialListings}
                filters={filters}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                favoriteIds={favoriteIds}
              />
            )}
          </div>
        ) : (
          /* Map view — map-dominant split (cards 1/3 left, map 2/3 right) on
             desktop; map-only on mobile (toggle to List for the card grid). */
          <div className="flex h-[calc(100vh-200px)]">
            {/* List panel — hidden on mobile when in map view */}
            <div className="hidden md:block md:w-1/3 overflow-y-auto border-r border-gray-200 bg-white">
              <div className="px-4 py-4">
                {listMode === "competitors" ? (
                  <CompetitorList
                    competitors={competitorClosures}
                    savedSet={savedSet}
                    onToggleSave={handleToggleSaveCompetitor}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                  />
                ) : (
                  <ListingGrid
                    initialListings={initialListings}
                    filters={filters}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                    singleColumn
                  />
                )}
              </div>
            </div>

            {/* Map panel */}
            <div className="w-full md:w-2/3 relative">
              <MapView
                listings={initialListings}
                competitors={competitorClosures}
                showCompetitors={showCompetitors}
                showListings={showListings}
                savedPlaceIds={savedCompetitorIdList}
                onToggleSaveCompetitor={handleToggleSaveCompetitor}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                onListingClick={handleListingClick}
                center={searchCenter}
                radiusMiles={searchCenter ? rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES : null}
              />

              {/* Hello Sugar listing layer toggle (top-left), mirroring the
                  competitor toggle on the right. Independent — both layers can
                  show at once. */}
              <button
                type="button"
                onClick={() => setShowListings((v) => !v)}
                aria-pressed={showListings}
                title={showListings ? "Hide Hello Sugar listings" : "Show Hello Sugar listings"}
                className={`
                  absolute top-3 left-3 z-10 inline-flex items-center gap-2
                  rounded-full border px-3 py-2 text-sm font-semibold shadow-md
                  transition-colors min-h-[40px]
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  ${showListings
                    ? "bg-white border-gray-300 text-gray-800 hover:bg-gray-50"
                    : "bg-gray-900/85 border-gray-900 text-white hover:bg-gray-900"}
                `}
              >
                {/* pink dot mirrors the listing pin shape */}
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-full border border-white"
                  style={{ backgroundColor: showListings ? "#db2777" : "#9ca3af" }}
                />
                <span>
                  Hello Sugar listings
                  <span className="ml-1 tabular-nums opacity-60">({initialListings.length})</span>
                </span>
              </button>

              {/* Competitor-closure layer toggle — only when the scraper has
                  pushed at least one closure. */}
              {competitorClosures.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCompetitors((v) => !v)}
                  aria-pressed={showCompetitors}
                  title={
                    showCompetitors
                      ? "Hide competitor closures"
                      : "Show competitor closures"
                  }
                  className={`
                    absolute top-3 right-3 z-10 inline-flex items-center gap-2
                    rounded-full border px-3 py-2 text-sm font-semibold shadow-md
                    transition-colors min-h-[40px]
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                    ${
                      showCompetitors
                        ? "bg-white border-gray-300 text-gray-800 hover:bg-gray-50"
                        : "bg-gray-900/85 border-gray-900 text-white hover:bg-gray-900"
                    }
                  `}
                >
                  {/* diamond glyph mirrors the competitor pin shape */}
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-3 rotate-45 rounded-[2px] border border-white"
                    style={{ backgroundColor: showCompetitors ? "#B9772E" : "#8F7067" }}
                  />
                  <span>
                    Competitor closures
                    <span className="ml-1 tabular-nums opacity-60">
                      ({competitorClosures.length}
                      {opportunityCount > 0 ? `, ${opportunityCount} opp.` : ""})
                    </span>
                  </span>
                </button>
              )}

              {shouldShowRadiusHint(viewMode, searchCenter !== null, hintDismissed) && (
                <RadiusSearchHint onDismiss={() => setHintDismissed(true)} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mobile filter drawer */}
      <MobileFilterDrawer isOpen={mobileFiltersOpen} onClose={() => setMobileFiltersOpen(false)} />
    </div>
  )
}
