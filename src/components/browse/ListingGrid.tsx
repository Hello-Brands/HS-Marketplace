"use client"

import { useEffect, useRef, useState } from "react"
import { useInView } from "react-intersection-observer"
import { getListings } from "@/lib/listings-query"
import type { ListingCard as ListingCardType, ListingFilters } from "@/lib/listings-query"
import { ListingCard } from "./ListingCard"
import { SkeletonCard } from "./SkeletonCard"

interface ListingGridProps {
  initialListings: ListingCardType[]
  filters: ListingFilters
  hoveredId?: string | null
  onHover?: (id: string | null) => void
  // Accepted from BrowsePage (favorited listing ids). Not yet rendered on the
  // browse card — reserved for the favorite indicator. Kept optional/inert so
  // the prop typechecks without dead destructuring.
  favoriteIds?: string[]
  // Stack cards in one column (used by the narrow map-view side panel); the
  // full-width list view keeps the responsive 1–3 column grid.
  singleColumn?: boolean
}

const PAGE_SIZE = 12

export function ListingGrid({ initialListings, filters, hoveredId, onHover, singleColumn }: ListingGridProps) {
  const [listings, setListings] = useState<ListingCardType[]>(initialListings)
  const [cursor, setCursor] = useState<string | null>(() => {
    if (initialListings.length !== PAGE_SIZE) return null
    const last = initialListings[initialListings.length - 1]
    if (!last) return null
    // Distance sort paginates on the numeric distance; other sorts on createdAt.
    return filters.sort === "distance"
      ? last.distanceMiles != null
        ? String(last.distanceMiles)
        : null
      : last.createdAt.toISOString()
  })
  const [hasMore, setHasMore] = useState(initialListings.length === PAGE_SIZE)
  const [loading, setLoading] = useState(false)

  const { ref: sentinelRef, inView } = useInView({ threshold: 0 })

  const filtersKey = JSON.stringify(filters)
  const isFirstRender = useRef(true)
  // Always-current filters for the pagination effect, so a filter change does
  // not itself trigger an append — page 1 is owned by the effect below.
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  // Monotonic request id so a slow in-flight response can never overwrite a
  // newer one (e.g. rapid successive radius/clear changes).
  const requestId = useRef(0)

  // Filters changed → refetch page 1 immediately. Crucially this does NOT wait
  // for the scroll sentinel to be in view, so results (or the empty state)
  // appear as soon as the location/radius/filters change or are cleared.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const id = ++requestId.current
    setLoading(true)
    getListings({ ...filters, cursor: undefined }).then(({ items, nextCursor }) => {
      if (id !== requestId.current) return // superseded by a newer change
      setListings(items)
      setCursor(nextCursor)
      setHasMore(!!nextCursor)
      setLoading(false)
    })
    // filtersKey is the stable string form of filters; filters itself is a fresh
    // object every render, so we intentionally key off the string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey])

  // Scroll sentinel → append the next page. Reads filtersRef so a filter change
  // never races this effect; only scrolling or a fresh cursor triggers it.
  useEffect(() => {
    if (!inView || !hasMore || loading) return
    const id = ++requestId.current
    setLoading(true)
    getListings({ ...filtersRef.current, cursor: cursor ?? undefined }).then(({ items, nextCursor }) => {
      if (id !== requestId.current) return
      setListings((prev) => [...prev, ...items])
      setCursor(nextCursor)
      setHasMore(!!nextCursor)
      setLoading(false)
    })
  }, [inView, hasMore, loading, cursor])

  const totalCount = listings.length

  if (!loading && totalCount === 0 && !hasMore) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-500 text-lg mb-2">No listings match your filters</p>
        <p className="text-gray-400 text-sm">Try adjusting your search criteria</p>
      </div>
    )
  }

  return (
    <div>
      {/* Count header */}
      <p className="text-sm text-gray-500 mb-4">
        {totalCount > 0 ? `${totalCount}${hasMore ? "+" : ""} listings` : ""}
      </p>

      {/* Grid */}
      <div className={`grid ${singleColumn ? "grid-cols-1 gap-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"}`}>
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            isHovered={hoveredId === listing.id}
            onHover={onHover}
            compact={singleColumn}
          />
        ))}

        {/* Skeleton cards while loading */}
        {loading &&
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={`skeleton-${i}`} />)}
      </div>

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-4" aria-hidden="true" />

      {/* End of results */}
      {!hasMore && totalCount > 0 && (
        <p className="text-center text-sm text-gray-400 mt-4">
          All {totalCount} listings shown
        </p>
      )}
    </div>
  )
}
