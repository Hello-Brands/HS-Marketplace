import { auth } from '@/auth'
import { ListingEditForm } from '@/components/listings/ListingEditForm'
import { toListingFormData } from '@/lib/listings/to-form-data'
import { loadSellerListing } from '@/lib/listings/load-listing'

// In Next.js 15+, params is a Promise
export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await auth()
  const listing = await loadSellerListing(id, session)

  const initialData = toListingFormData(listing)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Listing</h1>
      <ListingEditForm
        listingId={listing.id}
        initialData={initialData}
        isRejected={listing.status === 'rejected'}
      />
    </div>
  )
}
