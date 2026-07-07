"use client"

import { GeocodingControl } from "@maptiler/geocoding-control/react"
import "@maptiler/geocoding-control/style.css"
import type { Feature } from "@maptiler/geocoding-control/types"
import { useEffect, useRef, useState } from "react"

interface LocationSearchProps {
  onSelect: (location: { lng: number; lat: number; name: string }) => void
  variant?: "default" | "prominent"
}

export function LocationSearch({ onSelect, variant = "default" }: LocationSearchProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // The control builds requests with `new URL(apiUrl + "/" + query + ".json")`,
  // which throws on a relative apiUrl (surfacing as "Something went wrong…").
  // Resolve to an absolute origin on the client so the proxy is actually hit.
  const [apiUrl, setApiUrl] = useState("/api/geocode")
  useEffect(() => {
    setApiUrl(`${window.location.origin}/api/geocode`)
  }, [])

  // The geocoding-control's search button is hardcoded icon-only markup
  // (`<button class="search-button"><SearchIcon /></button>`) with no prop to
  // configure an accessible name, and it mounts asynchronously inside the
  // control's shadow-free DOM. A MutationObserver (rather than a fixed delay)
  // labels it as soon as it appears, and keeps re-labeling if the control
  // ever re-renders its internal markup.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function labelSearchButton(el: HTMLElement) {
      const button = el.querySelector<HTMLButtonElement>(".search-button")
      if (button && !button.hasAttribute("aria-label")) {
        button.setAttribute("aria-label", "Search")
      }
    }

    labelSearchButton(container)
    const observer = new MutationObserver(() => labelSearchButton(container))
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

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
    <div ref={containerRef} className={`hs-geocoder${variant === "prominent" ? " hs-geocoder--lg" : ""}`}>
      <GeocodingControl
        apiKey={process.env.NEXT_PUBLIC_MAPTILER_API_KEY!}
        apiUrl={apiUrl}
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
