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
  if (!reviews || reviews.totalReviews === 0) return null

  const { avgRating, totalReviews, distribution, featured } = reviews
  const maxCount = Math.max(...distribution.map((d) => d.count), 1)

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

        {/* Featured review */}
        {featured ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-3">★ Top review</p>
            <div className="flex items-center gap-3 mb-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-800 text-sm font-semibold">
                {featured.reviewerName.charAt(0).toUpperCase()}
              </span>
              <div>
                <div className="text-sm font-medium text-gray-900">{featured.reviewerName}</div>
                <div className="text-xs text-gray-500">
                  {formatReviewDate(featured.date)} · <Stars avg={featured.rating} className="text-xs align-middle" />
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-700">{featured.comment}</p>
            {featured.ownerReplied && (
              <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                ✓ Owner replied
              </span>
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
