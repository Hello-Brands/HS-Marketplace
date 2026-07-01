"use client"

import { ListingGrid } from "./ListingGrid"
import { CompetitorList } from "./CompetitorList"
import { listSections } from "@/lib/browse-list-sections"
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
  const both = sections.listings && sections.competitors

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
          {both && <h2 className={HEADING}>Hello Sugar listings</h2>}
          <ListingGrid
            initialListings={initialListings}
            filters={filters}
            hoveredId={hoveredId}
            onHover={onHover}
            favoriteIds={favoriteIds}
            singleColumn={singleColumn}
          />
        </div>
      )}
      {sections.competitors && (
        <div>
          {both && <h2 className={HEADING}>Competitors</h2>}
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
