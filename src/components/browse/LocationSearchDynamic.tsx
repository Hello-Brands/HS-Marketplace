"use client"

import dynamic from "next/dynamic"

// Load the MapTiler geocoding control (and its CSS) only when a LocationSearch
// actually renders, keeping the heavy @maptiler/geocoding-control bundle out of
// the initial /browse chunk (DEBT-016). Client-only: the control touches window.
export const LocationSearch = dynamic(
  () => import("./LocationSearch").then((m) => m.LocationSearch),
  { ssr: false },
)
