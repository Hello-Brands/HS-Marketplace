import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import { ListingEditForm } from '@/components/listings/ListingEditForm'
import { toListingFormData } from '@/lib/listings/to-form-data'

export default async function AdminEditListingPage({
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
    },
  })

  if (!listing) {
    notFound()
  }

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
