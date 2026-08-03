"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createAlert } from "@/lib/alert-actions"
import { AlertModal } from "./AlertModal"
import { AlertScopeFields } from "./AlertScopeFields"
import { scopeSelected, type AlertScope } from "@/lib/save-search-validation"
import { RADIUS_MIN_MILES, RADIUS_MAX_MILES } from "@/components/browse/FilterBar"

/** Default radius for a watch-this-area search around an owned salon. */
export const WATCH_DEFAULT_RADIUS_MILES = 5

export interface WatchAreaLocation {
  name: string
  latitude: number
  longitude: number
}

interface WatchAreaDialogProps {
  location: WatchAreaLocation | null
  onClose: () => void
}

/**
 * Save a radius search centered on one of the viewer's owned salons. Produces a
 * completely normal saved search (origin 'user'): deletable, editable, both
 * closure types, ledger-seeded by createAlert.
 */
export function WatchAreaDialog({ location, onClose }: WatchAreaDialogProps) {
  const [radius, setRadius] = useState(WATCH_DEFAULT_RADIUS_MILES)
  const [scope, setScope] = useState<AlertScope>({ includeListings: false, includeCompetitors: true })
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reset per location so a second open doesn't leak the previous salon's state.
  useEffect(() => {
    if (location) {
      setRadius(WATCH_DEFAULT_RADIUS_MILES)
      setScope({ includeListings: false, includeCompetitors: true })
      setName(`Near ${location.name}`)
      setSavedName(null)
      setError(null)
    }
  }, [location])

  if (!location && !savedName) return null

  async function handleSave() {
    if (!location) return
    if (!scopeSelected(scope)) {
      setError("Pick at least one thing to be notified about.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await createAlert({
      name: name.trim() || `Near ${location.name}`,
      centerLat: location.latitude,
      centerLng: location.longitude,
      radiusMiles: radius,
      centerLabel: location.name,
      includeListings: scope.includeListings,
      includeCompetitors: scope.includeCompetitors,
    })
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      setSavedName(name.trim() || `Near ${location.name}`)
    }
  }

  // Success confirmation state (location may already be cleared by the parent).
  if (savedName) {
    return (
      <AlertModal open onClose={onClose} title="Search saved">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">{savedName}</span> is saved. We&apos;ll email you when
          something new appears in that area.
        </p>
        <div className="mt-4 flex items-center justify-end gap-3">
          <Link href="/account/alerts" className="text-sm font-medium text-hs-red-600 hover:text-hs-red-700">
            View in My Alerts →
          </Link>
          <button type="button" onClick={onClose} className="min-h-[40px] px-4 rounded-lg bg-gray-900 text-white text-sm font-semibold">
            Done
          </button>
        </div>
      </AlertModal>
    )
  }

  return (
    <AlertModal open onClose={onClose} title={`Watch the area around ${location!.name}`}>
      <div className="space-y-4">
        <div>
          <label htmlFor="watch-radius" className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 block">
            Radius
          </label>
          <div className="flex items-center gap-3">
            <input
              id="watch-radius"
              type="range"
              min={RADIUS_MIN_MILES}
              max={RADIUS_MAX_MILES}
              step={1}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="flex-1 h-2 cursor-pointer accent-hs-red-600"
            />
            <span className="text-sm font-medium text-gray-700 tabular-nums w-14">{radius} mi</span>
          </div>
        </div>
        <AlertScopeFields value={scope} onChange={setScope} />
        <div>
          <label htmlFor="watch-name" className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 block">
            Name
          </label>
          <input
            id="watch-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
          />
        </div>
        {error && <p className="text-xs text-hs-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-[40px] px-3 text-sm text-gray-500 hover:text-gray-700">
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
  )
}
