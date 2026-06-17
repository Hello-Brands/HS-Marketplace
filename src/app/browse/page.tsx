import { Suspense } from "react"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getListings, type ListingFilters, type ListingSort } from "@/lib/listings-query"
import { BrowsePage } from "@/components/browse/BrowsePage"
import { SkeletonCard } from "@/components/browse/SkeletonCard"

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
    <div className="flex flex-col min-h-screen">
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

  const isAdmin = session.user.role === "admin"
  // Admins can also list/sell, and franchisees get seller access by default.
  const hasSeller = !!session.user.sellerAccess || isAdmin

  // Fetch initial listings server-side (filtered by the URL) for fast first paint.
  const { items: initialListings } = await getListings(parseFilters(searchParams))

  return (
    <BrowsePage initialListings={initialListings} isAdmin={isAdmin} hasSeller={hasSeller} />
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
