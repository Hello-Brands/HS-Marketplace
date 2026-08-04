import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/db'
import { favorites } from '@/db/schema/favorites'
import { savedCompetitors } from '@/db/schema/savedCompetitors'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq, and, inArray } from 'drizzle-orm'
import { EmptyStateIllustrated } from '@/components/ui/EmptyState'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { formatUsdCentsCompact } from '@/lib/money'
import { formatClosureDetected } from '@/lib/closure-recency'

export const metadata = {
  title: 'Saved Listings - Hello Sugar Marketplace',
}

async function getFavoriteListings(userId: string) {
  // Get user's favorite listing IDs
  const favoriteRows = await db.query.favorites.findMany({
    where: eq(favorites.userId, userId),
    columns: { listingId: true },
    orderBy: (fav, { desc }) => [desc(fav.createdAt)],
  })

  if (favoriteRows.length === 0) {
    return []
  }

  const favoriteIds = favoriteRows.map(f => f.listingId)

  // NOTE (DEBT-018): This is two sequential roundtrips (favorite IDs, then
  // listing details) where a single join would do. Left as-is to keep the
  // change low-risk; the inArray fetch below loses the createdAt-desc order
  // from favoriteRows, so we re-sort in memory to restore it.
  // Fetch listing details for favorites
  const favoriteListings = await db.query.listings.findMany({
    where: and(
      inArray(listings.id, favoriteIds),
      eq(listings.status, 'active')
    ),
    with: {
      locations: {
        limit: 1,
        orderBy: [listingLocations.displayOrder],
      },
      photos: {
        limit: 1,
        orderBy: [listingPhotos.displayOrder],
      },
    },
  })

  // Restore the createdAt-desc order of favoriteRows: inArray does not preserve
  // it, so index each returned listing by id and emit them in favoriteIds order.
  const listingById = new Map(favoriteListings.map(listing => [listing.id, listing]))

  return favoriteIds
    .map(id => listingById.get(id))
    .filter((listing): listing is (typeof favoriteListings)[number] => listing !== undefined)
    .map(listing => ({
      id: listing.id,
      type: listing.type,
      askingPrice: listing.askingPrice,
      title: listing.title,
      createdAt: listing.createdAt,
      locationName: listing.locations[0]?.name ?? null,
      city: listing.locations[0]?.city ?? null,
      state: listing.locations[0]?.state ?? null,
      primaryPhotoUrl: listing.photos[0]?.url ?? null,
    }))
}

async function getSavedCompetitors(userId: string) {
  return db.query.savedCompetitors.findMany({
    where: eq(savedCompetitors.userId, userId),
    orderBy: (sc, { desc }) => [desc(sc.createdAt)],
  })
}

function competitorStatusLabel(status: string): string {
  if (status === 'CLOSED_PERMANENTLY') return 'Permanently Closed'
  if (status === 'CLOSED_TEMPORARILY') return 'Temporarily Closed'
  return status
}

const TYPE_LABELS: Record<string, string> = {
  suite: 'Suite',
  flagship: 'Flagship',
  territory: 'Territory',
  bundle: 'Bundle',
}

export default async function FavoritesPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  // These two fetches are independent (neither uses the other's result), so
  // run them concurrently instead of sequentially.
  const [favoriteListings, savedComps] = await Promise.all([
    getFavoriteListings(session.user.id),
    getSavedCompetitors(session.user.id),
  ])

  return (
    <>
      <SiteHeader
        world="marketplace"
        title="Saved Listings"
        subtitle={`${favoriteListings.length} saved listing${favoriteListings.length !== 1 ? 's' : ''} · ${savedComps.length} competitor${savedComps.length !== 1 ? 's' : ''}`}
      />
      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8 pb-tabbar">
      {favoriteListings.length === 0 ? (
        <EmptyStateIllustrated
          title="No saved listings yet"
          description="Tap the heart icon on any listing to save it for later."
          action={
            <Link
              href="/browse"
              className="inline-flex items-center px-5 py-2.5 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 transition-colors"
            >
              Browse listings
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {favoriteListings.map(listing => (
            <Link
              key={listing.id}
              href={`/listings/${listing.id}`}
              className="group flex gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
            >
              {/* Thumbnail */}
              <div className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
                {listing.primaryPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={listing.primaryPhotoUrl}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-hs-red-50">
                    <span className="text-hs-red-400 font-bold">HS</span>
                  </div>
                )}
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {TYPE_LABELS[listing.type] ?? listing.type}
                  </span>
                </div>
                <p className="text-lg font-bold text-hs-red-600">{formatUsdCentsCompact(listing.askingPrice)}</p>
                <p className="text-sm font-medium text-gray-900 truncate">
                  {[listing.city, listing.state].filter(Boolean).join(', ') || 'Location TBD'}
                </p>
                {listing.locationName && (
                  <p className="text-xs text-gray-500 truncate">{listing.locationName}</p>
                )}
              </div>

              {/* Arrow */}
              <div className="flex items-center">
                <svg
                  className="h-5 w-5 text-gray-400 group-hover:text-hs-red-600 group-hover:translate-x-1 transition-all"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
        {savedComps.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Saved competitor locations</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {savedComps.map((c) => {
                const permanent = c.businessStatus === 'CLOSED_PERMANENTLY'
                const place = [c.city, c.state].filter(Boolean).join(', ')
                const detectedLine = formatClosureDetected(c.closedAt)
                return (
                  <div
                    key={c.id}
                    className="flex flex-col gap-2 p-4 bg-white rounded-xl border border-gray-200"
                  >
                    <p className="text-sm font-bold text-gray-900 truncate">{c.brandName}</p>
                    <span
                      className={`inline-block w-fit text-xs font-semibold px-2 py-0.5 rounded-full ${
                        permanent
                          ? 'bg-hs-red-100 text-hs-red-700'
                          : 'bg-hs-caramel-50 text-hs-caramel-600'
                      }`}
                    >
                      {competitorStatusLabel(c.businessStatus)}
                    </span>
                    <p className="text-xs text-gray-500 truncate">
                      {c.address}{place ? ` · ${place}` : ''}
                    </p>
                    {detectedLine && (
                      <p className="text-xs text-hs-taupe">{detectedLine}</p>
                    )}
                    {c.mapsUrl && (
                      <a
                        href={c.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700"
                      >
                        View on Google Maps →
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </main>
    </>
  )
}
