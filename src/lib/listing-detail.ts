'use server'

import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { users } from '@/db/schema/auth'
import { eq } from 'drizzle-orm'

export interface ListingDetailLocation {
  id: string
  locationType: 'salon' | 'territory'
  name: string
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  squareFootage: number | null
  openingDate: Date | null
  ttmRevenue: number | null
  mcr: number | null
  territoryLat: number | null
  territoryLng: number | null
  territoryRadius: number | null
  displayOrder: number
  bqLocationName: string | null
  dataMappingStatus: 'unconfirmed' | 'confirmed' | 'not_connected'
}

export interface ListingDetail {
  id: string
  type: 'suite' | 'flagship' | 'territory' | 'bundle'
  status: string
  title: string | null
  askingPrice: number
  ttmProfit: number | null
  reasonForSelling: string | null
  inventoryIncluded: boolean
  laserIncluded: boolean
  otherAssets: string | null
  notes: string | null
  createdAt: Date
  viewCount: number
  inquiryCount: number
  seller: {
    id: string
    name: string | null
    email: string | null
  }
  locations: ListingDetailLocation[]
  photos: {
    id: string
    url: string
    displayOrder: number
  }[]
}

export async function getListingById(id: string): Promise<ListingDetail | null> {
  // Only return active listings — buyers should not see draft/pending/rejected
  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, id),
    with: {
      seller: true,
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder] },
    },
  })

  if (!listing || listing.status !== 'active') {
    return null
  }

  return {
    id: listing.id,
    type: listing.type as 'suite' | 'flagship' | 'territory' | 'bundle',
    status: listing.status,
    title: listing.title,
    askingPrice: listing.askingPrice,
    ttmProfit: listing.ttmProfit ?? null,
    reasonForSelling: listing.reasonForSelling ?? null,
    inventoryIncluded: listing.inventoryIncluded,
    laserIncluded: listing.laserIncluded,
    otherAssets: listing.otherAssets ?? null,
    notes: listing.notes ?? null,
    createdAt: listing.createdAt,
    viewCount: listing.viewCount,
    inquiryCount: listing.inquiryCount,
    seller: {
      id: listing.seller.id,
      name: listing.seller.name ?? null,
      email: listing.seller.email ?? null,
    },
    locations: listing.locations.map(loc => ({
      id: loc.id,
      locationType: loc.locationType as 'salon' | 'territory',
      name: loc.name,
      address: loc.address ?? null,
      city: loc.city ?? null,
      state: loc.state ?? null,
      zipCode: loc.zipCode ?? null,
      squareFootage: loc.squareFootage ?? null,
      openingDate: loc.openingDate ?? null,
      ttmRevenue: loc.ttmRevenue ?? null,
      mcr: loc.mcr ?? null,
      territoryLat: loc.territoryLat ?? null,
      territoryLng: loc.territoryLng ?? null,
      territoryRadius: loc.territoryRadius ?? null,
      displayOrder: loc.displayOrder,
      bqLocationName: loc.bqLocationName ?? null,
      dataMappingStatus: loc.dataMappingStatus,
    })),
    photos: listing.photos.map(p => ({
      id: p.id,
      url: p.url,
      displayOrder: p.displayOrder,
    })),
  }
}
