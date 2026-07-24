"use client"

import { useQueryState } from "nuqs"
import { viewModeParser } from "@/lib/view-mode"
import { useListingFilters, DEFAULT_RADIUS_MILES } from "./FilterBar"
import { LocationSearch } from "./LocationSearchDynamic"

// Mobile browse header search (row 1 of the compact header). Mirrors
// BrowsePage.handleLocationSelect exactly, but communicates via nuqs since it
// renders in the server header tree, not under BrowsePage.
export function BrowseHeaderSearch() {
  const [rawFilters, setFilters] = useListingFilters()
  const [, setView] = useQueryState("view", viewModeParser)

  function handleSelect(location: { lng: number; lat: number; name: string }) {
    setFilters(
      {
        centerLat: location.lat,
        centerLng: location.lng,
        centerLabel: location.name,
        radiusMiles: rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES,
      },
      { shallow: false }
    )
    setView("map")
  }

  return <LocationSearch onSelect={handleSelect} />
}
