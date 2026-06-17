import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/db'
import { favorites } from '@/db/schema/favorites'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq, and, inArray } from 'drizzle-orm'
import { EmptyStateIllustrated } from '@/components/ui/EmptyState'
import { Breadcrumb } from '@/components/ui/Breadcrumb'

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

  return favoriteListings.map(listing => ({
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

function formatPrice(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1_000_000) {
    return `$${(dollars / 1_000_000).toFixed(1)}M`
  }
  if (dollars >= 1_000) {
    return `$${(dollars / 1_000).toFixed(0)}k`
  }
  return `$${dollars.toLocaleString()}`
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

  const favoriteListings = await getFavoriteListings(session.user.id)

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      <Breadcrumb
        items={[
          { label: 'Browse', href: '/browse' },
          { label: 'Saved Listings' },
        ]}
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Saved Listings</h1>
          <p className="text-gray-500 mt-1">
            {favoriteListings.length} saved listing{favoriteListings.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/browse"
          className="text-sm font-medium text-hs-red-600 hover:text-hs-red-700 hover:underline underline-offset-2"
        >
          Browse more
        </Link>
      </div>

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
                <p className="text-lg font-bold text-hs-red-600">{formatPrice(listing.askingPrice)}</p>
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
    </div>
  )
}
