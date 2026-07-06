"use client"

import { useState } from "react"
import Link from "next/link"
import type { Alert } from "@/db/schema/alerts"
import { describeSavedSearch, savedSearchToBrowseParams } from "@/lib/saved-search"

interface SavedSearchCardProps {
  alert: Alert
  onRename: (id: string, name: string | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToggleNotify: (id: string, enabled: boolean) => Promise<void>
}

export function SavedSearchCard({ alert, onRename, onDelete, onToggleNotify }: SavedSearchCardProps) {
  const summary = describeSavedSearch(alert)
  const title = alert.name?.trim() || summary
  const browseHref = `/browse?${savedSearchToBrowseParams(alert)}`

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(alert.name ?? "")
  const [busy, setBusy] = useState(false)

  async function saveName() {
    setBusy(true)
    await onRename(alert.id, draftName.trim() || null)
    setBusy(false)
    setRenaming(false)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName() }}
                placeholder={summary}
                className="h-9 w-full min-w-0 rounded-lg border border-gray-300 px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
              />
              <button onClick={saveName} disabled={busy} className="inline-flex items-center min-h-[40px] px-2 text-sm font-semibold text-hs-red-600 hover:text-hs-red-700">Save</button>
              <button onClick={() => { setRenaming(false); setDraftName(alert.name ?? "") }} className="inline-flex items-center min-h-[40px] px-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          ) : (
            <>
              <h3 className="text-base font-semibold text-gray-900 truncate">{title}</h3>
              {alert.name?.trim() && <p className="text-xs text-gray-500 truncate mt-0.5">{summary}</p>}
            </>
          )}
        </div>

        {/* Notifications toggle */}
        <label className="flex items-center gap-2 text-xs text-gray-600 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={alert.notifyEnabled}
            onChange={(e) => onToggleNotify(alert.id, e.target.checked)}
            className="w-4 h-4 accent-hs-red-600"
          />
          Notify
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Link
          href={browseHref}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700"
        >
          Apply search →
        </Link>
        {!renaming && (
          <button onClick={() => setRenaming(true)} className="inline-flex items-center min-h-[40px] px-2 -mx-2 text-sm font-medium text-gray-600 hover:text-gray-900">Rename</button>
        )}
        <button onClick={() => onDelete(alert.id)} className="inline-flex items-center min-h-[40px] px-2 -mr-2 text-sm font-medium text-hs-red-600 hover:text-hs-red-700 ml-auto">Delete</button>
      </div>
    </div>
  )
}
