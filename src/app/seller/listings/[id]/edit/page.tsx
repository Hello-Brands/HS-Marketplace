import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import { ListingEditForm } from '@/components/listings/ListingEditForm'
import type { ListingFormData } from '@/lib/listings/types'

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

  // Transform DB shape to form data shape
  const initialData: ListingFormData = {
    type: listing.type,
    locations: listing.locations.map(loc => ({
      id: loc.id,
      type: loc.locationType as 'salon' | 'territory',
      externalId: loc.externalId ?? undefined,
      name: loc.name,
      address: loc.address ?? undefined,
      city: loc.city ?? undefined,
      state: loc.state ?? undefined,
      zipCode: loc.zipCode ?? undefined,
      squareFootage: loc.squareFootage ?? undefined,
      openingDate: loc.openingDate ?? undefined,
      ttmRevenue: loc.ttmRevenue ?? undefined,
      mcr: loc.mcr ?? undefined,
      territoryLat: loc.territoryLat ?? undefined,
      territoryLng: loc.territoryLng ?? undefined,
      territoryRadius: loc.territoryRadius ?? undefined,
    })),
    askingPrice: listing.askingPrice / 100,
    ttmProfit: listing.ttmProfit ? listing.ttmProfit / 100 : undefined,
    reasonForSelling: listing.reasonForSelling ?? undefined,
    photos: listing.photos.map(p => ({
      id: p.id,
      url: p.url,
      filename: p.filename,
      order: p.displayOrder,
    })),
    inventoryIncluded: listing.inventoryIncluded,
    laserIncluded: listing.laserIncluded,
    inventoryCostEstimate:
      listing.inventoryCostEstimate != null ? listing.inventoryCostEstimate / 100 : undefined,
    otherAssets: listing.otherAssets ?? undefined,
    notes: listing.notes ?? undefined,
  }

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
