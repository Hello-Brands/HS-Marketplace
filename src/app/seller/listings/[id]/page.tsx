import { auth } from '@/auth'
import Link from 'next/link'
import { StatusBadge } from '@/components/listings/StatusBadge'
import { getAvailableActions } from '@/lib/listings/status-machine'
import { ListingActions } from '@/components/listings/ListingActions'
import { formatUsdCents } from '@/lib/money'
import { loadSellerListing } from '@/lib/listings/load-listing'
import type { ListingStatus } from '@/lib/listings/types'

// In Next.js 15+, params is a Promise
export default async function SellerListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await auth()
  const listing = await loadSellerListing(id, session)

  const availableActions = getAvailableActions(listing.status as ListingStatus, 'seller')
  const formattedPrice = formatUsdCents(listing.askingPrice)

  return (
    <div>
      {/* Rejection banner */}
      {listing.status === 'rejected' && listing.rejectionReason && (
        <div className="bg-hs-red-50 border border-hs-red-200 rounded-lg p-4 mb-6">
          <p className="text-hs-red-800">
            <span className="font-medium">Your listing was rejected:</span> {listing.rejectionReason}
          </p>
          <Link
            href={`/seller/listings/${listing.id}/edit`}
            className="inline-flex mt-2 px-4 py-2 bg-hs-red-600 text-white rounded-lg text-sm font-medium hover:bg-hs-red-700"
          >
            Edit to Resubmit
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-y-2 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-gray-900">{listing.title}</h1>
            <StatusBadge status={listing.status as ListingStatus} size="md" />
          </div>
          <p className="text-gray-500 capitalize">{listing.type}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/seller/listings/${listing.id}/edit`}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Edit
          </Link>
          <ListingActions listingId={listing.id} availableActions={availableActions} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Photos */}
          {listing.photos.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
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

          {/* Locations */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-medium text-gray-900 mb-3">Locations</h3>
            <div className="space-y-3">
              {listing.locations.map(loc => (
                <div key={loc.id} className="p-3 bg-gray-50 rounded-lg">
                  <p className="font-medium">{loc.name}</p>
                  {loc.address && (
                    <p className="text-sm text-gray-500">{loc.address}, {loc.city}, {loc.state}</p>
                  )}
                  {loc.squareFootage && (
                    <p className="text-sm text-gray-500">{loc.squareFootage} sq ft</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          {listing.notes && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-2">Notes</h3>
              <p className="text-gray-600 whitespace-pre-wrap">{listing.notes}</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-2xl font-bold text-hs-red-600">{formattedPrice}</p>
            <p className="text-gray-500 text-sm">Asking price</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
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

          {(listing.inventoryIncluded || listing.laserIncluded || listing.otherAssets) && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="font-medium text-gray-900 mb-3">Included Assets</h3>
              <ul className="space-y-1 text-gray-600">
                {listing.inventoryIncluded && <li>&#10003; Inventory</li>}
                {listing.laserIncluded && <li>&#10003; Laser device</li>}
                {listing.otherAssets && <li>&#10003; {listing.otherAssets}</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
