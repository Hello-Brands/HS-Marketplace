import type { CompetitorClosure } from "@/lib/competitor-query"

/**
 * The payload shape persisted by `toggleSavedCompetitor`. A snapshot of the
 * competitor's display fields so a saved item still renders after the scraper
 * removes the source row. Shared by the list rows and the map popup.
 */
export interface SavedCompetitorInput {
  placeId: string
  brandName: string
  address: string
  city: string
  state: string
  lat: number
  lng: number
  businessStatus: string
  mapsUrl: string | null
}

export function competitorToSnapshot(c: CompetitorClosure): SavedCompetitorInput {
  return {
    placeId: c.googlePlaceId,
    brandName: c.brandName,
    address: c.address,
    city: c.city,
    state: c.state,
    lat: c.latitude,
    lng: c.longitude,
    businessStatus: c.businessStatus,
    mapsUrl: c.mapsUrl,
  }
}
