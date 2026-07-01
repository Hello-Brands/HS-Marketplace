'use client'

import { useState } from 'react'
import type { LocationReviewSummary } from '@/lib/bigquery/queries'
import { formatRating, starStates, formatReviewDate } from '@/lib/kpi/reviews-display'

function Stars({ avg, className = '' }: { avg: number; className?: string }) {
  return (
    <span className={`inline-flex gap-0.5 ${className}`} aria-label={`${formatRating(avg)} out of 5 stars`}>
      {starStates(avg).map((state, i) => (
        <span key={i} className={state === 'empty' ? 'text-gray-300' : 'text-amber-400'}>
          {state === 'half' ? '⯨' : state === 'full' ? '★' : '☆'}
        </span>
      ))}
    </span>
  )
}

export function LocationReviewsPanel({ reviews }: { reviews: LocationReviewSummary | null }) {
  const [index, setIndex] = useState(0)

  if (!reviews || reviews.totalReviews === 0) return null

  const { avgRating, totalReviews, distribution } = reviews
  // Default topReviews: a cached summary serialized before this field existed
  // (see the versioned cache key in getReviewSummaryByLocation) has no topReviews.
  // Missing/empty degrades to the "no written review" state instead of crashing.
  const topReviews = reviews.topReviews ?? []
  const maxCount = Math.max(...distribution.map((d) => d.count), 1)

  // Clamp in case a re-render hands us fewer reviews than the current index.
  const safeIndex = Math.min(index, Math.max(topReviews.length - 1, 0))
  const current = topReviews[safeIndex] ?? null
  const showControls = topReviews.length > 1

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Reviews &amp; Reputation</h3>
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 rounded-lg border border-gray-200 bg-white p-5">
        {/* Summary + distribution */}
        <div className="text-center md:border-r md:border-gray-100 md:pr-6">
          <div className="text-5xl font-semibold leading-none text-gray-900 tabular-nums">
            {formatRating(avgRating)}
          </div>
          <Stars avg={avgRating} className="mt-2 text-xl justify-center" />
          <p className="mt-1 text-sm text-gray-500">
            {totalReviews.toLocaleString('en-US')} Google reviews
          </p>
          <div className="mt-4 flex flex-col gap-1.5">
            {distribution.map((d) => (
              <div key={d.stars} className="grid grid-cols-[14px_1fr_38px] items-center gap-2">
                <span className="text-xs text-gray-500 tabular-nums">{d.stars}</span>
                <span className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <span
                    className="block h-full bg-amber-400 rounded-full"
                    style={{ width: `${(d.count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="text-xs text-gray-400 text-right tabular-nums">
                  {totalReviews > 0 ? Math.round((d.count / totalReviews) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Featured review carousel */}
        {current ? (
          <div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">★ Top reviews</p>
                {showControls && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                      disabled={safeIndex === 0}
                      aria-label="Previous review"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-hs-red-300 hover:text-hs-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                    >
                      ‹
                    </button>
                    <span className="min-w-[34px] text-center text-xs tabular-nums text-gray-500">
                      {safeIndex + 1} / {topReviews.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIndex((i) => Math.min(i + 1, topReviews.length - 1))}
                      disabled={safeIndex === topReviews.length - 1}
                      aria-label="Next review"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-hs-red-300 hover:text-hs-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-800 text-sm font-semibold">
                  {current.reviewerName.charAt(0).toUpperCase()}
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-900">{current.reviewerName}</div>
                  <div className="text-xs text-gray-500">
                    {formatReviewDate(current.date)} · <Stars avg={current.rating} className="text-xs align-middle" />
                  </div>
                </div>
              </div>
              {current.comment.trim() && (
                <p className="text-sm text-gray-700">{current.comment}</p>
              )}
              {current.ownerReplied && (
                <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                  ✓ Owner replied
                </span>
              )}
            </div>
            {showControls && (
              <div className="mt-3 flex justify-center gap-1.5">
                {topReviews.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Go to review ${i + 1}`}
                    className={`h-[7px] rounded-full transition-all ${
                      i === safeIndex ? 'w-[18px] bg-hs-red-600' : 'w-[7px] bg-gray-300 hover:bg-gray-400'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-400">
            No written review available yet.
          </div>
        )}
      </div>
    </div>
  )
}
