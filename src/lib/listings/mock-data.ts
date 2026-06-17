import type { LocationSelection } from './types'

// Mock data simulating Hello Sugar internal API response
// These represent open salons the seller owns
export const MOCK_SELLER_LOCATIONS: LocationSelection[] = [
  {
    id: 'loc-001',
    type: 'salon',
    externalId: 'hs-atl-001',
    name: 'Hello Sugar Atlanta Buckhead',
    address: '3035 Peachtree Rd NE',
    city: 'Atlanta',
    state: 'GA',
    zipCode: '30305',
    squareFootage: 1200,
    openingDate: new Date('2022-03-15'),
    ttmRevenue: 42500000, // $425,000 in cents
    mcr: 0.32,
    latitude: 33.8389,
    longitude: -84.3792,
  },
  {
    id: 'loc-002',
    type: 'salon',
    externalId: 'hs-atl-002',
    name: 'Hello Sugar Atlanta Midtown',
    address: '1075 Peachtree St NE',
    city: 'Atlanta',
    state: 'GA',
    zipCode: '30309',
    squareFootage: 1500,
    openingDate: new Date('2023-01-10'),
    ttmRevenue: 38000000, // $380,000 in cents
    mcr: 0.28,
    latitude: 33.7890,
    longitude: -84.3833,
  },
  {
    id: 'loc-003',
    type: 'salon',
    externalId: 'hs-dal-001',
    name: 'Hello Sugar Dallas Uptown',
    address: '2500 McKinney Ave',
    city: 'Dallas',
    state: 'TX',
    zipCode: '75201',
    squareFootage: 1100,
    openingDate: new Date('2021-08-20'),
    ttmRevenue: 51000000, // $510,000 in cents
    mcr: 0.35,
    latitude: 32.7990,
    longitude: -96.8030,
  },
]

// Mock existing Hello Sugar locations for territory map context
export const EXISTING_HS_LOCATIONS = [
  { lat: 33.8486, lng: -84.3625, name: 'HS Buckhead' },
  { lat: 33.7866, lng: -84.3830, name: 'HS Midtown' },
  { lat: 32.7997, lng: -96.8022, name: 'HS Dallas Uptown' },
  { lat: 33.7734, lng: -84.2963, name: 'HS Decatur' },
]

export async function getSellerLocations(userId: string): Promise<LocationSelection[]> {
  // In Phase 4, this will call internal API
  // For now, return mock data for any seller
  void userId
  return MOCK_SELLER_LOCATIONS
}
