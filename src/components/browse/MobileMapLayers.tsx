"use client"

import { useState } from "react"
import { BottomSheet } from "@/components/ui"
import { MapLayerRows } from "./MapLegend"

// Mobile replacement for the always-open MapLegend panel: a small circular
// layers button over the map that opens the layer toggles in a bottom sheet.
export function MobileMapLayers() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Map key and layers"
        className="md:hidden absolute bottom-4 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
        </svg>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Map key">
        <p className="pb-2 text-xs text-gray-400">Tap a row to show or hide it on the map</p>
        <MapLayerRows />
      </BottomSheet>
    </>
  )
}
