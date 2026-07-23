import Image from "next/image"
import Link from "next/link"
import { centsToDollars, formatUsdCents } from "@/lib/money"
import type { ListingCard as ListingCardType } from "@/lib/listings-query"
import { FavoriteHeart } from "./FavoriteHeart"

const TYPE_LABELS: Record<string, string> = {
  suite: "Suite",
  flagship: "Flagship",
  territory: "Territory",
  bundle: "Bundle",
}

const TYPE_COLORS: Record<string, string> = {
  suite: "bg-hs-red-100 text-hs-red-800",
  flagship: "bg-gray-900 text-white",
  territory: "bg-sky-100 text-sky-800",
  bundle: "bg-amber-100 text-amber-800",
}

interface ListingCardProps {
  listing: ListingCardType
  isHovered?: boolean
  onHover?: (id: string | null) => void
  // Horizontal, low-height layout for the narrow map-view side panel so several
  // results are visible at once. The full-width grid uses the default card.
  compact?: boolean
  // When provided, renders the favorite heart (browse grid). Undefined keeps
  // the card exactly as before for call sites without favorites data.
  favorited?: boolean
}

// The browse grid abbreviates millions ("$1.2M") but shows full thousands
// ("$500,000") — distinct from the map/favorites compact "$500k" form, so it
// keeps its own million-abbreviation and defers to formatUsdCents below $1M.
function formatPrice(cents: number): string {
  const dollars = centsToDollars(cents)
  if (dollars >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(1)}M`
  }
  return formatUsdCents(cents)
}

export function ListingCard({ listing, isHovered, onHover, compact, favorited }: ListingCardProps) {
  const cityState =
    [listing.city, listing.state].filter(Boolean).join(", ") || "Location not specified"

  if (compact) {
    return (
      <Link
        href={`/listings/${listing.id}`}
        className={`
          group flex gap-3 rounded-xl border bg-white p-2
          transition-all duration-200 ease-out hover:shadow-md
          ${isHovered ? "ring-2 ring-hs-red-500 shadow-md border-hs-red-200" : "border-gray-200 shadow-sm"}
        `}
        onMouseEnter={() => onHover?.(listing.id)}
        onMouseLeave={() => onHover?.(null)}
      >
        {/* Thumbnail */}
        <div className="relative h-20 w-20 shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200">
          {listing.primaryPhotoUrl ? (
            <Image
              src={listing.primaryPhotoUrl}
              alt={listing.locationName ?? "Listing photo"}
              fill
              className="object-cover"
              sizes="80px"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-hs-red-50">
              <span className="text-hs-red-300 text-lg font-bold">HS</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1 py-0.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-bold text-hs-red-600 tracking-tight tabular-nums">
              {formatPrice(listing.askingPrice)}
            </p>
            <span className="flex items-center gap-1">
              <span
                className={`
                  shrink-0 inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md
                  ${TYPE_COLORS[listing.type] ?? "bg-gray-100 text-gray-700"}
                `}
              >
                {TYPE_LABELS[listing.type] ?? listing.type}
              </span>
              {favorited !== undefined && (
                <span className="-my-2 -mr-2">
                  <FavoriteHeart listingId={listing.id} initialFavorited={favorited} />
                </span>
              )}
            </span>
          </div>
          <p className="text-sm font-medium text-gray-900 truncate mt-0.5">{cityState}</p>
          {listing.locationName && (
            <p className="text-xs text-gray-500 truncate">{listing.locationName}</p>
          )}
          {listing.distanceMiles != null && (
            <p className="text-xs font-semibold text-hs-red-600 mt-0.5">
              {listing.distanceMiles < 0.1 ? "< 0.1" : listing.distanceMiles.toFixed(1)} mi away
            </p>
          )}
        </div>
      </Link>
    )
  }

  return (
    <Link
      href={`/listings/${listing.id}`}
      className={`
        group block rounded-xl overflow-hidden border bg-white
        transition-all duration-300 ease-out
        hover:shadow-xl hover:-translate-y-1
        ${isHovered ? "ring-2 ring-hs-red-500 shadow-xl border-hs-red-200 -translate-y-1" : "border-gray-200 shadow-sm"}
      `}
      onMouseEnter={() => onHover?.(listing.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* Photo */}
      <div className="relative aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
        {listing.primaryPhotoUrl ? (
          <Image
            src={listing.primaryPhotoUrl}
            alt={listing.locationName ?? "Listing photo"}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-hs-red-50">
            <div className="w-16 h-16 bg-hs-red-100 rounded-2xl flex items-center justify-center">
              <span className="text-hs-red-400 text-2xl font-bold">HS</span>
            </div>
          </div>
        )}

        {/* Gradient overlay at bottom for text readability */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/25 to-transparent pointer-events-none" />

        {/* Type badge overlay */}
        <div className="absolute top-3 left-3">
          <span
            className={`
              inline-flex items-center
              px-2.5 py-1 text-xs font-semibold rounded-lg
              shadow-sm backdrop-blur-sm
              ${TYPE_COLORS[listing.type] ?? "bg-gray-100 text-gray-700"}
            `}
          >
            {TYPE_LABELS[listing.type] ?? listing.type}
          </span>
        </div>

        {/* Favorite heart overlay */}
        {favorited !== undefined && (
          <div className="absolute top-2 right-2">
            <FavoriteHeart listingId={listing.id} initialFavorited={favorited} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Price */}
            <p className="text-xl font-bold text-hs-red-600 tracking-tight tabular-nums">
              {formatPrice(listing.askingPrice)}
            </p>

            {/* Location */}
            <p className="text-sm font-medium text-gray-900 mt-1">
              {[listing.city, listing.state].filter(Boolean).join(", ") ||
                "Location not specified"}
            </p>

            {/* Location name */}
            {listing.locationName && (
              <p className="text-xs text-gray-500 truncate mt-0.5">
                {listing.locationName}
              </p>
            )}

            {/* Distance from search center (only when a location search is active) */}
            {listing.distanceMiles != null && (
              <p className="text-xs font-semibold text-hs-red-600 mt-1">
                {listing.distanceMiles < 0.1 ? "< 0.1" : listing.distanceMiles.toFixed(1)} mi away
              </p>
            )}
          </div>
        </div>

        {/* View indicator on hover */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400 group-hover:text-gray-600 transition-colors duration-200">
            View details
          </span>
          <svg
            className="h-4 w-4 text-gray-400 group-hover:text-hs-red-600 group-hover:translate-x-1 transition-all duration-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  )
}
