import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import { ListingEditForm } from '@/components/listings/ListingEditForm'
import { toListingFormData } from '@/lib/listings/to-form-data'

// In Next.js 15+, params is a Promise
export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

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

  if (listing.sellerId !== session.user.id && session.user.role !== 'admin') {
    redirect('/seller/listings')
  }

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
