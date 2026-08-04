"use client"

import { useState } from "react"
import { WatchAreaDialog } from "./WatchAreaDialog"

interface WatchAreaButtonProps {
  locationName: string
  latitude: number | null
  longitude: number | null
}

/** "Watch this area" entry point on /account/locations/[id]. Disabled (with an
 * explanation) for locations the directory hasn't geocoded yet. */
export function WatchAreaButton({ locationName, latitude, longitude }: WatchAreaButtonProps) {
  const [open, setOpen] = useState(false)
  const hasCoords = latitude != null && longitude != null

  return (
    <>
      <button
        type="button"
        onClick={() => hasCoords && setOpen(true)}
        disabled={!hasCoords}
        title={hasCoords ? undefined : "This location doesn't have map coordinates yet, so a radius search can't be centered on it."}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        Watch this area
      </button>
      <WatchAreaDialog
        location={open && hasCoords ? { name: locationName, latitude: latitude as number, longitude: longitude as number } : null}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
