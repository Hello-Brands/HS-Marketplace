"use client"

import { useOptimistic, useState, useTransition } from "react"
import { toggleFavorite } from "@/lib/favorites-actions"

// Icon-only optimistic favorite toggle for browse cards. Lives INSIDE the
// card's <Link>, so it must preventDefault/stopPropagation to not navigate.
// Same confirmed-state + useOptimistic pattern as FavoriteButtonLarge: on
// failure the optimistic value auto-reverts to the last confirmed state.
interface FavoriteHeartProps {
  listingId: string
  initialFavorited: boolean
}

export function FavoriteHeart({ listingId, initialFavorited }: FavoriteHeartProps) {
  const [isPending, startTransition] = useTransition()
  const [favorited, setFavorited] = useState(initialFavorited)
  const [optimisticFavorited, setOptimisticFavorited] = useOptimistic(favorited)

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (isPending) return
    startTransition(async () => {
      setOptimisticFavorited(!optimisticFavorited)
      try {
        const result = await toggleFavorite(listingId)
        setFavorited(result.favorited)
      } catch {
        // Optimistic update auto-reverts to the last confirmed value.
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={optimisticFavorited ? "Remove from saved listings" : "Save listing"}
      aria-pressed={optimisticFavorited}
      aria-busy={isPending}
      className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
    >
      <svg
        className={`h-6 w-6 transition-colors ${isPending ? "animate-pulse" : ""} ${
          optimisticFavorited ? "text-hs-red-600" : "text-black/35"
        }`}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="white"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}
