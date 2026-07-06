import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { listings, listingPhotos } from '@/db/schema/listings'
import { eq, desc } from 'drizzle-orm'
import Link from 'next/link'
import { ListingCard } from '@/components/listings/ListingCard'

export default async function SellerListingsPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  const userListings = await db.query.listings.findMany({
    where: eq(listings.sellerId, session.user.id),
    orderBy: [desc(listings.createdAt)],
    with: {
      photos: {
        orderBy: [listingPhotos.displayOrder],
        limit: 1,
      },
    },
  })

  if (userListings.length === 0) {
    return (
      <div className="text-center py-16">
        <h2 className="text-xl font-medium text-gray-900 mb-2">No listings yet</h2>
        <p className="text-gray-500 mb-6">Create your first listing to start selling.</p>
        <Link
          href="/seller/listings/new"
          className="inline-flex px-6 py-2 bg-hs-red-600 text-white rounded-lg font-medium hover:bg-hs-red-700"
        >
          Create Listing
        </Link>
      </div>
    )
  }

  // Single listing: redirect to detail view
  if (userListings.length === 1) {
    const listing = userListings[0]
    redirect(`/seller/listings/${listing.id}`)
  }

  // Multiple listings: show card grid
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-6">
        <h1 className="min-w-0 text-2xl font-bold text-gray-900">My Listings</h1>
        <Link
          href="/seller/listings/new"
          className="px-4 py-2 bg-hs-red-600 text-white rounded-lg text-sm font-medium hover:bg-hs-red-700"
        >
          Create Listing
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {userListings.map(listing => (
          <ListingCard
            key={listing.id}
            id={listing.id}
            title={listing.title || 'Untitled'}
            type={listing.type}
            status={listing.status}
            askingPrice={listing.askingPrice}
            coverPhotoUrl={listing.photos[0]?.url}
            viewCount={listing.viewCount}
            inquiryCount={listing.inquiryCount}
            rejectionReason={listing.rejectionReason}
            createdAt={listing.createdAt}
          />
        ))}
      </div>
    </div>
  )
}
