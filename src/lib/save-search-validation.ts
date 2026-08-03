/** The filter fields that make a saved search non-empty. Mirrors SaveSearchInput. */
export interface SaveSearchFilterCheck {
  query?: string | null
  types?: string[]
  states?: string[]
  minPrice?: number | null
  maxPrice?: number | null
  minYearsOpen?: number | null
  inventoryIncluded?: boolean | null
  centerLat?: number | null
  centerLng?: number | null
  radiusMiles?: number | null
}

/**
 * Sort is ordering, not a filter — an empty save would create an "all listings"
 * alert that emails on every approved listing, so require at least one real
 * filter. (Moved out of SaveSearchButton so the watch dialog shares it.)
 */
export function hasAnyRealFilter(f: SaveSearchFilterCheck): boolean {
  return (
    !!(f.query && f.query.trim()) ||
    (f.types?.length ?? 0) > 0 ||
    (f.states?.length ?? 0) > 0 ||
    f.minPrice != null ||
    f.maxPrice != null ||
    (f.minYearsOpen != null && f.minYearsOpen > 0) ||
    f.inventoryIncluded === true ||
    (f.centerLat != null && f.centerLng != null && f.radiusMiles != null)
  )
}

/** What a saved search notifies about. */
export interface AlertScope {
  includeListings: boolean
  includeCompetitors: boolean
}

export function scopeSelected(s: AlertScope): boolean {
  return s.includeListings || s.includeCompetitors
}
