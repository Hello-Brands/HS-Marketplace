"use client"

/** Show the radius-search hint only in map view, before a location is chosen, and not dismissed. */
export function shouldShowRadiusHint(
  viewMode: "list" | "map",
  hasCenter: boolean,
  dismissed: boolean
): boolean {
  return viewMode === "map" && !hasCenter && !dismissed
}

/**
 * A small prompt pill floated over the top of the map, pointing at the location
 * search box, that surfaces the otherwise-hidden radius filter. Desktop only.
 */
export function RadiusSearchHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="hidden sm:flex absolute top-3 left-1/2 -translate-x-1/2 z-10 items-center gap-2 rounded-full border border-hs-red-200 bg-white/95 px-4 py-2 text-sm text-hs-red-700 shadow-md backdrop-blur">
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      <span className="whitespace-nowrap">Search a location above to filter by distance</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-1 inline-flex items-center justify-center rounded-full p-0.5 text-hs-red-400 hover:text-hs-red-600 hover:bg-hs-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
