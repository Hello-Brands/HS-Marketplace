// Active-filter count for the mobile Filters pill badge. Mirrors
// FilterBar.hasActiveFilters, but as a count and shared/testable.

export interface CountableFilters {
  query: string
  types: string[]
  states: string[]
  minPrice: number | null
  maxPrice: number | null
  minYearsOpen: number | null
  inventoryIncluded: boolean
  centerLat: number | null
}

export function countListingFilters(f: CountableFilters): number {
  return (
    (f.query ? 1 : 0) +
    (f.types.length > 0 ? 1 : 0) +
    (f.states.length > 0 ? 1 : 0) +
    (f.minPrice !== null || f.maxPrice !== null ? 1 : 0) +
    (f.minYearsOpen !== null && f.minYearsOpen > 0 ? 1 : 0) +
    (f.inventoryIncluded ? 1 : 0) +
    (f.centerLat !== null ? 1 : 0)
  )
}
