"use client"

import { useState } from "react"
import Link from "next/link"
import { createAlert } from "@/lib/alert-actions"
import { AlertScopeFields } from "@/components/alerts/AlertScopeFields"
import { AlertModal } from "@/components/alerts/AlertModal"
import { hasAnyRealFilter, scopeSelected, type AlertScope } from "@/lib/save-search-validation"

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
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [scope, setScope] = useState<AlertScope>({ includeListings: true, includeCompetitors: true })

  function handleOpen() {
    if (!hasAnyRealFilter(filters)) {
      setError("Add at least one filter before saving a search.")
      return
    }
    setError(null)
    setName("")
    // Checkbox defaults come from the current map layer toggles — but now the
    // user SEES and confirms them instead of silently inheriting.
    setScope({
      includeListings: filters.includeListings ?? true,
      includeCompetitors: filters.includeCompetitors ?? true,
    })
    setOpen(true)
  }

  async function handleSave() {
    if (!scopeSelected(scope)) {
      setError("Pick at least one thing to be notified about.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await createAlert({
      name: name.trim() || undefined,
      query: filters.query || undefined,
      states: filters.states && filters.states.length > 0 ? filters.states : undefined,
      listingTypes: filters.types && filters.types.length > 0 ? filters.types : undefined,
      minPrice: filters.minPrice ?? undefined,
      maxPrice: filters.maxPrice ?? undefined,
      minYearsOpen: filters.minYearsOpen ?? undefined,
      inventoryIncluded: filters.inventoryIncluded || undefined,
      sort: filters.sort || undefined,
      centerLat: filters.centerLat ?? undefined,
      centerLng: filters.centerLng ?? undefined,
      radiusMiles: filters.radiusMiles ?? undefined,
      centerLabel: filters.centerLabel || undefined,
      includeListings: scope.includeListings,
      includeCompetitors: scope.includeCompetitors,
    })
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      setOpen(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleOpen}
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
      {error && !open && <p className="text-xs text-hs-red-600">{error}</p>}

      <AlertModal open={open} onClose={() => setOpen(false)} title="Save this search">
        <div className="space-y-4">
          <AlertScopeFields value={scope} onChange={setScope} />
          <div>
            <label htmlFor="save-search-name" className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 block">
              Name <span className="font-normal normal-case">(optional)</span>
            </label>
            <input
              id="save-search-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Utah suites under $500k"
              maxLength={120}
              className="h-10 w-full rounded-lg border border-gray-300 px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
            />
          </div>
          {error && <p className="text-xs text-hs-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="min-h-[40px] px-3 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="min-h-[40px] px-4 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save search"}
            </button>
          </div>
        </div>
      </AlertModal>
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
