import type { Alert } from "@/db/schema/alerts"
import { isWithinRadius } from "./geo"

export type AlertMatchCriteria = Pick<
  Alert,
  | "notifyEnabled" | "includeListings" | "states" | "listingTypes"
  | "minPrice" | "maxPrice" | "minYearsOpen" | "centerLat" | "centerLng" | "radiusMiles"
>

export interface MatchLocation {
  latitude: number | null
  longitude: number | null
  territoryLat: number | null
  territoryLng: number | null
  openingDate: Date | null
}

export interface MatchListingInput {
  type: string
  state: string | null
  askingPrice: number | null
}

/**
 * Pure listing/alert match (ANDs across set criteria). `now` is injected so the
 * minYearsOpen cutoff is testable. `query` and `sort` are intentionally NOT
 * matched.
 */
export function listingMatchesAlert(
  alert: AlertMatchCriteria,
  listing: MatchListingInput,
  locations: MatchLocation[],
  now: Date
): boolean {
  if (alert.notifyEnabled === false) return false
  if (alert.includeListings === false) return false

  if (alert.states && alert.states.length > 0) {
    if (!listing.state || !alert.states.includes(listing.state)) return false
  }
  if (alert.listingTypes && alert.listingTypes.length > 0) {
    if (!alert.listingTypes.includes(listing.type)) return false
  }
  if (alert.minPrice != null && (listing.askingPrice == null || listing.askingPrice < alert.minPrice)) return false
  if (alert.maxPrice != null && (listing.askingPrice == null || listing.askingPrice > alert.maxPrice)) return false

  if (alert.minYearsOpen != null && alert.minYearsOpen > 0) {
    const cutoff = new Date(now)
    cutoff.setFullYear(cutoff.getFullYear() - alert.minYearsOpen)
    const ok = locations.some((l) => l.openingDate != null && l.openingDate <= cutoff)
    if (!ok) return false
  }

  if (alert.centerLat != null && alert.centerLng != null && alert.radiusMiles != null) {
    const ok = locations.some((l) => {
      const lat = l.latitude ?? l.territoryLat
      const lng = l.longitude ?? l.territoryLng
      return lat != null && lng != null &&
        isWithinRadius(alert.centerLat!, alert.centerLng!, lat, lng, alert.radiusMiles!)
    })
    if (!ok) return false
  }
  return true
}
