'use client'

interface SaveCompetitorButtonProps {
  saved: boolean
  onToggle: () => void
}

// Controlled heart toggle — parent owns the saved state so the map popup and
// the list row stay in sync. Mirrors FavoriteButton's look.
export function SaveCompetitorButton({ saved, onToggle }: SaveCompetitorButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      aria-pressed={saved}
      aria-label={saved ? 'Remove saved competitor' : 'Save competitor'}
      className="
        p-2 rounded-full bg-white/80 backdrop-blur-sm
        hover:bg-white transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500
      "
    >
      <svg
        className={`h-5 w-5 transition-colors ${saved ? 'text-hs-red-600 fill-current' : 'text-gray-600'}`}
        fill={saved ? 'currentColor' : 'none'}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
    </button>
  )
}
