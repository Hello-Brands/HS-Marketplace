"use client"

import { useState } from "react"
import Link from "next/link"
import { createAlert } from "@/lib/alert-actions"

export interface SaveSearchInput {
  query?: string | null
  types?: string[]
  states?: string[]
  minPrice?: number | null
  maxPrice?: number | null
  minYearsOpen?: number | null
  inventoryIncluded?: boolean | null
  sort?: string | null
  centerLat?: number | null
  centerLng?: number | null
  radiusMiles?: number | null
  centerLabel?: string | null
  includeListings?: boolean
  includeCompetitors?: boolean
}

export function SaveSearchButton({ filters }: { filters: SaveSearchInput }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sort is ordering, not a filter — exclude it. An empty save would create an
  // "all listings" alert that emails on every approved listing, so require at
  // least one real filter.
  const hasAnyFilter =
    !!(filters.query && filters.query.trim()) ||
    (filters.types?.length ?? 0) > 0 ||
    (filters.states?.length ?? 0) > 0 ||
    filters.minPrice != null ||
    filters.maxPrice != null ||
    (filters.minYearsOpen != null && filters.minYearsOpen > 0) ||
    (filters.centerLat != null && filters.centerLng != null && filters.radiusMiles != null)

  async function handleSaveSearch() {
    if (!hasAnyFilter) {
      setError("Add at least one filter before saving a search.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await createAlert({
      query: filters.query || undefined,
      states: filters.states && filters.states.length > 0 ? filters.states : undefined,
      listingTypes: filters.types && filters.types.length > 0 ? filters.types : undefined,
      minPrice: filters.minPrice ?? undefined,
      maxPrice: filters.maxPrice ?? undefined,
      minYearsOpen: filters.minYearsOpen ?? undefined,
      sort: filters.sort || undefined,
      centerLat: filters.centerLat ?? undefined,
      centerLng: filters.centerLng ?? undefined,
      radiusMiles: filters.radiusMiles ?? undefined,
      centerLabel: filters.centerLabel || undefined,
      includeListings: filters.includeListings,
      includeCompetitors: filters.includeCompetitors,
    })
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSaveSearch}
        disabled={saving || saved}
        className={[
          "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2",
          saved ? "bg-green-100 text-green-800" : "bg-white border border-gray-300 hover:bg-gray-50 text-gray-700",
          saving || saved ? "opacity-75 cursor-not-allowed" : "",
        ].filter(Boolean).join(" ")}
      >
        {saving ? "Saving..." : saved ? "Saved!" : (<><BellIcon /> Save this search</>)}
      </button>
      {saved && (
        <Link href="/account/alerts" className="text-xs font-medium text-hs-red-600 hover:text-hs-red-700">
          View in My Alerts →
        </Link>
      )}
      {error && <p className="text-xs text-hs-red-600">{error}</p>}
    </div>
  )
}

function BellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
