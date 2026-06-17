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
}

const PAGE_SIZE = 12

export function ListingGrid({ initialListings, filters, hoveredId, onHover }: ListingGridProps) {
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

  // Track previous filters to detect changes
  const filtersKey = JSON.stringify(filters)
  const prevFiltersKey = useRef(filtersKey)
  const isFirstRender = useRef(true)

  // Reset when filters change (not on first render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (prevFiltersKey.current === filtersKey) return
    prevFiltersKey.current = filtersKey

    setListings([])
    setCursor(null)
    setHasMore(true)
  }, [filtersKey])

  // Load more when sentinel is in view
  useEffect(() => {
    if (!inView || !hasMore || loading) return

    setLoading(true)
    getListings({ ...filters, cursor: cursor ?? undefined }).then(({ items, nextCursor }) => {
      setListings((prev) => {
        // After filter reset, prev will be [] so this just sets the initial page
        return [...prev, ...items]
      })
      setCursor(nextCursor)
      setHasMore(!!nextCursor)
      setLoading(false)
    })
  }, [inView, hasMore, loading, filters, cursor])

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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {listings.map((listing) => (
          <ListingCard
            key={listing.id}
            listing={listing}
            isHovered={hoveredId === listing.id}
            onHover={onHover}
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
