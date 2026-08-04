import { Suspense } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getListings, type ListingFilters, type ListingSort } from "@/lib/listings-query"
import { getCompetitorClosures } from "@/lib/competitor-query"
import { getUnlistedHsLocations } from "@/lib/hs-locations-query"
import { getSavedCompetitorPlaceIds } from "@/lib/saved-competitors-actions"
import { getMyMapOwnership } from "@/lib/owner-map/data"
import { getFavoriteListingIds } from "@/lib/favorites-actions"
import { shouldShowOwnerAlertsPrompt } from "@/lib/owner-alerts/prompt"
import { OwnerAlertsPrompt } from "@/components/alerts/OwnerAlertsPrompt"
import { BrowsePage } from "@/components/browse/BrowsePage"
import { BrowseHeaderSearch } from "@/components/browse/BrowseHeaderSearch"
import { SkeletonCard } from "@/components/browse/SkeletonCard"
import { SiteHeader } from "@/components/layout/SiteHeader"

type RawSearchParams = Record<string, string | string[] | undefined>

// Parse URL search params into ListingFilters so the initial server render
// reflects the URL (incl. radius search). Mirrors the nuqs parsers in FilterBar.
function parseFilters(sp: RawSearchParams): ListingFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const num = (v: string | string[] | undefined) => {
    const n = Number(one(v))
    return Number.isFinite(n) ? n : undefined
  }
  const list = (v: string | string[] | undefined) => {
    const s = one(v)
    return s ? s.split(",").filter(Boolean) : undefined
  }
  return {
    query: one(sp.query) || undefined,
    types: list(sp.types),
    states: list(sp.states),
    minPrice: num(sp.minPrice),
    maxPrice: num(sp.maxPrice),
    sort: (one(sp.sort) as ListingSort) || undefined,
    minYearsOpen: num(sp.minYearsOpen),
    centerLat: num(sp.centerLat),
    centerLng: num(sp.centerLng),
    radiusMiles: num(sp.radiusMiles),
  }
}

function BrowsePageSkeleton() {
  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      {/* Filter bar placeholder */}
      <div className="bg-white border-b h-14 animate-pulse" />
      {/* View controls placeholder */}
      <div className="bg-white border-b h-10 animate-pulse" />
      {/* Grid skeleton */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

async function BrowseContent({ searchParams }: { searchParams: RawSearchParams }) {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }

  // Fetch listings and competitor closures together. getCompetitorClosures is
  // resilient (returns [] if the scraper table is empty/unavailable), so it
  // never blocks the page.
  const filters = parseFilters(searchParams)
  const [
    { items: initialListings },
    competitorClosures,
    savedCompetitorIds,
    hsLocations,
    mapOwnership,
    favoriteIds,
    showOwnerPrompt,
  ] = await Promise.all([
    getListings(filters),
    getCompetitorClosures({
      centerLat: filters.centerLat,
      centerLng: filters.centerLng,
      radiusMiles: filters.radiusMiles,
      states: filters.states,
    }),
    getSavedCompetitorPlaceIds(),
    getUnlistedHsLocations({
      centerLat: filters.centerLat,
      centerLng: filters.centerLng,
      radiusMiles: filters.radiusMiles,
      states: filters.states,
    }),
    getMyMapOwnership(),
    getFavoriteListingIds(),
    shouldShowOwnerAlertsPrompt(),
  ])
  const count = initialListings.length

  return (
    // Viewport-pinned shell: header + browse content are clamped to the window
    // height so the map fills the viewport (Zillow-style) and only inner panels
    // scroll — never the whole page. See BrowsePage for the flex height chain.
    <div className="flex flex-col h-[100dvh] overflow-hidden">
      <SiteHeader
        world="marketplace"
        title="Browse Listings"
        subtitle={`${count} active listing${count !== 1 ? "s" : ""}`}
        mobileSearch={<BrowseHeaderSearch />}
      />
      {showOwnerPrompt && (
        <div className="shrink-0 px-4 pt-3 max-w-7xl mx-auto w-full">
          <OwnerAlertsPrompt />
        </div>
      )}
      <BrowsePage
        initialListings={initialListings}
        competitorClosures={competitorClosures}
        savedCompetitorIds={savedCompetitorIds}
        hsLocations={hsLocations}
        mapOwnership={mapOwnership}
        favoriteIds={favoriteIds}
      />
    </div>
  )
}

export default async function BrowseRoute({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const sp = await searchParams
  return (
    <Suspense fallback={<BrowsePageSkeleton />}>
      <BrowseContent searchParams={sp} />
    </Suspense>
  )
}
