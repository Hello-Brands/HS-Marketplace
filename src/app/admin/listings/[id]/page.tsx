import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import { StatusBadge } from '@/components/listings/StatusBadge'
import { formatUsdCents } from '@/lib/money'

export default async function AdminListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (session?.user?.role !== 'admin') {
    redirect('/login')
  }

  const { id } = await params

  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, id),
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder] },
      seller: true,
    },
  })

  if (!listing) {
    notFound()
  }

  const formattedPrice = formatUsdCents(listing.askingPrice)

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/listings" className="text-gray-500 hover:text-gray-700">
          &larr; Back to Listings
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-y-2 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-display text-2xl font-bold text-gray-900">{listing.title}</h1>
            <StatusBadge status={listing.status} size="md" />
          </div>
          <p className="text-gray-500">
            Seller: {listing.seller?.name || 'Unknown'} ({listing.seller?.email})
          </p>
        </div>
        <Link
          href={`/admin/listings/${listing.id}/edit`}
          className="px-4 py-2 bg-hs-red-600 text-white rounded-lg text-sm font-medium hover:bg-hs-red-700"
        >
          Edit Listing
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {listing.photos.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {listing.photos.map((photo, i) => (
                  <div
                    key={photo.id}
                    className={`aspect-square rounded-lg overflow-hidden ${i === 0 ? 'col-span-2 row-span-2' : ''}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.url} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="font-medium text-gray-900 mb-3">Locations</h3>
            <div className="space-y-3">
              {listing.locations.map(loc => (
                <div key={loc.id} className="p-3 bg-gray-50 rounded-lg">
                  <p className="font-medium">{loc.name}</p>
                  {loc.address && (
                    <p className="text-sm text-gray-500">{loc.address}, {loc.city}, {loc.state}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-2xl font-bold text-hs-red-600">{formattedPrice}</p>
            <p className="text-gray-500 text-sm">Asking price</p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="font-medium text-gray-900 mb-3">Analytics</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-2xl font-bold text-gray-900">{listing.viewCount}</p>
                <p className="text-gray-500 text-sm">Views</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{listing.inquiryCount}</p>
                <p className="text-gray-500 text-sm">Inquiries</p>
              </div>
            </div>
          </div>

          {listing.rejectionReason && (
            <div className="bg-hs-red-50 border border-hs-red-200 rounded-lg p-4">
              <h3 className="font-medium text-hs-red-800 mb-1">Rejection Reason</h3>
              <p className="text-hs-red-700 text-sm">{listing.rejectionReason}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
