"use client"

import { useCallback, useState } from "react"
import { ListingGrid } from "./ListingGrid"
import { CompetitorList } from "./CompetitorList"
import { listSections } from "@/lib/browse-list-sections"
import { LISTINGS_PAGE_SIZE, formatListingCount } from "@/lib/browse/listing-count"
import type { ListingCard, ListingFilters } from "@/lib/listings-query"
import type { CompetitorClosure } from "@/lib/competitor-query"

interface BrowseListContentProps {
  showListings: boolean
  showCompetitors: boolean
  initialListings: ListingCard[]
  filters: ListingFilters
  favoriteIds: string[]
  competitorClosures: CompetitorClosure[]
  savedSet: Set<string>
  onToggleSaveCompetitor: (c: CompetitorClosure) => void
  onSelectCompetitor: (c: CompetitorClosure) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
  singleColumn?: boolean
}

const HEADING = "text-xs font-bold uppercase tracking-wider text-gray-400 mb-3"

export function BrowseListContent({
  showListings,
  showCompetitors,
  initialListings,
  filters,
  favoriteIds,
  competitorClosures,
  savedSet,
  onToggleSaveCompetitor,
  onSelectCompetitor,
  hoveredId,
  onHover,
  singleColumn = false,
}: BrowseListContentProps) {
  const sections = listSections(showListings, showCompetitors, competitorClosures.length > 0)
  // Collapsed on load so owners land on competitor closures. Deliberately NOT
  // in the URL or localStorage: it's a reading preference, not shareable state,
  // and a nuqs flag would ride along in every shared /browse link.
  const [listingsOpen, setListingsOpen] = useState(false)
  const listingsCollapsed = sections.collapsibleListings && !listingsOpen

  // Seeded to match ListingGrid's own initial state exactly (same page-size
  // check) so the badge is correct on first paint with no flash. ListingGrid
  // then keeps this current via onCountChange as filters/pagination change —
  // the server-rendered initialListings prop never updates itself because
  // filter changes use nuqs shallow routing.
  const [gridCount, setGridCount] = useState<{ count: number; hasMore: boolean }>(() => ({
    count: initialListings.length,
    hasMore: initialListings.length === LISTINGS_PAGE_SIZE,
  }))
  // Stable identity (empty deps) so it can sit in ListingGrid's onCountChange
  // effect deps without re-triggering that effect every render; no-ops when
  // the values are unchanged so it can't loop.
  const handleCountChange = useCallback((count: number, hasMore: boolean) => {
    setGridCount((prev) => (prev.count === count && prev.hasMore === hasMore ? prev : { count, hasMore }))
  }, [])

  if (sections.empty) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        No results to show. Toggle <span className="font-semibold">Hello Sugar</span> or{" "}
        <span className="font-semibold">Competitors</span> above.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {sections.listings && (
        <div>
          {sections.collapsibleListings && (
            <button
              type="button"
              onClick={() => setListingsOpen((o) => !o)}
              aria-expanded={listingsOpen}
              aria-controls="hs-listings-panel"
              className={`${HEADING} flex w-full items-center gap-2 rounded-md text-left transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2`}
            >
              <span>Hello Sugar listings</span>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-200 px-1.5 text-[11px] font-bold tabular-nums text-gray-700">
                {formatListingCount(gridCount.count, gridCount.hasMore)}
              </span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${listingsOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
          {/* Kept MOUNTED and hidden rather than unmounted: ListingGrid fetches
             on mount, so unmounting would re-fetch on every expand. `hidden`
             also removes it from the accessibility tree. */}
          <div id="hs-listings-panel" hidden={listingsCollapsed}>
            <ListingGrid
              initialListings={initialListings}
              filters={filters}
              hoveredId={hoveredId}
              onHover={onHover}
              favoriteIds={favoriteIds}
              singleColumn={singleColumn}
              onCountChange={handleCountChange}
            />
          </div>
        </div>
      )}
      {sections.competitors && (
        <div>
          {sections.collapsibleListings && <h2 className={HEADING}>Competitors</h2>}
          <CompetitorList
            competitors={competitorClosures}
            savedSet={savedSet}
            onToggleSave={onToggleSaveCompetitor}
            onSelect={onSelectCompetitor}
            hoveredId={hoveredId}
            onHover={onHover}
          />
        </div>
      )}
    </div>
  )
}
