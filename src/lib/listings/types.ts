export type ListingStatus = 'draft' | 'pending' | 'active' | 'rejected' | 'sold' | 'delisted'
export type ListingType = 'suite' | 'flagship' | 'territory' | 'bundle'
export type LocationType = 'salon' | 'territory'

export interface Photo {
  id: string
  url: string
  filename: string
  order: number
}

export interface LocationSelection {
  id: string
  type: LocationType
  externalId?: string
  name: string
  address?: string
  city?: string
  state?: string
  zipCode?: string
  squareFootage?: number
  openingDate?: Date
  ttmRevenue?: number
  mcr?: number
  // Salon coordinates (for radius search). Territory uses territoryLat/Lng below.
  latitude?: number
  longitude?: number
  territoryLat?: number
  territoryLng?: number
  territoryRadius?: number
}

export interface ListingFormData {
  // Step 1
  type: ListingType
  locations: LocationSelection[]
  // Step 2
  askingPrice: number
  ttmProfit?: number
  reasonForSelling?: string
  // Step 3
  photos: Photo[]
  inventoryIncluded: boolean
  laserIncluded: boolean
  otherAssets?: string
  notes?: string
}
