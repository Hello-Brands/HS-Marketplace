"use client"

import type { AlertScope } from "@/lib/save-search-validation"

interface AlertScopeFieldsProps {
  value: AlertScope
  onChange: (next: AlertScope) => void
}

/**
 * The explicit "notify me about" choice shared by the save-search popover and
 * the watch-area dialog, so the two flows can't drift.
 */
export function AlertScopeFields({ value, onChange }: AlertScopeFieldsProps) {
  return (
    <fieldset>
      <legend className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
        Notify me about
      </legend>
      <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[36px] cursor-pointer">
        <input
          type="checkbox"
          checked={value.includeCompetitors}
          onChange={(e) => onChange({ ...value, includeCompetitors: e.target.checked })}
          className="w-4 h-4 accent-hs-red-600"
        />
        Competitor closures
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[36px] cursor-pointer">
        <input
          type="checkbox"
          checked={value.includeListings}
          onChange={(e) => onChange({ ...value, includeListings: e.target.checked })}
          className="w-4 h-4 accent-hs-red-600"
        />
        Hello Sugar listings for sale
      </label>
    </fieldset>
  )
}
