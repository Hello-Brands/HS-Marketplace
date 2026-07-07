import { auth } from '@/auth'
import { ListingEditForm } from '@/components/listings/ListingEditForm'
import { toListingFormData } from '@/lib/listings/to-form-data'
import { loadAdminListing } from '@/lib/listings/load-listing'

export default async function AdminEditListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  const { id } = await params

  const listing = await loadAdminListing(id, session)

  const initialData = toListingFormData(listing)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Edit Listing (Admin)</h1>
      <p className="text-gray-500 mb-6">
        Editing as admin. Changes will not trigger resubmission.
      </p>
      <ListingEditForm
        listingId={listing.id}
        initialData={initialData}
        isRejected={false}
        isAdmin={true}
      />
    </div>
  )
}
