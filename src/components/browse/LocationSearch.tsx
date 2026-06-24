"use client"

import { GeocodingControl } from "@maptiler/geocoding-control/react"
import "@maptiler/geocoding-control/style.css"
import type { Feature } from "@maptiler/geocoding-control/types"

interface LocationSearchProps {
  onSelect: (location: { lng: number; lat: number; name: string }) => void
}

export function LocationSearch({ onSelect }: LocationSearchProps) {
  // onPick receives { feature: Feature | undefined } per the geocoding control API
  function handlePick(event: { feature: Feature | undefined }) {
    const feature = event.feature
    if (!feature) return
    if (feature.geometry.type === "Point") {
      const [lng, lat] = feature.geometry.coordinates as [number, number]
      onSelect({ lng, lat, name: feature.place_name })
    } else if (feature.center) {
      const [lng, lat] = feature.center
      onSelect({ lng, lat, name: feature.place_name })
    }
  }

  return (
    <div className="hs-geocoder">
      <GeocodingControl
        apiKey={process.env.NEXT_PUBLIC_MAPTILER_API_KEY!}
        apiUrl="/api/geocode"
        country={["US"]}
        types={["municipality", "place", "region", "subregion", "county", "postal_code"]}
        proximity={[{ type: "fixed", coordinates: [-98.5795, 39.8283] }]}
        limit={5}
        onPick={handlePick}
        placeholder="Search by city, state, or zip..."
      />
    </div>
  )
}
