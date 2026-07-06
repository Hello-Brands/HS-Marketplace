import Link from 'next/link'
import { StatusBadge } from './StatusBadge'
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder'
import { formatUsdCents } from '@/lib/money'
import type { ListingStatus, ListingType } from '@/lib/listings/types'

interface ListingCardProps {
  id: string
  title: string
  type: ListingType
  status: ListingStatus
  askingPrice: number
  coverPhotoUrl?: string
  viewCount: number
  inquiryCount: number
  rejectionReason?: string | null
  createdAt: Date
}

const typeLabels: Record<ListingType, string> = {
  suite: 'Suite',
  flagship: 'Flagship',
  territory: 'Territory',
  bundle: 'Bundle',
}

const STATUS_BORDER: Record<ListingStatus, string> = {
  draft: 'border-l-gray-400',
  pending: 'border-l-amber-500',
  active: 'border-l-emerald-500',
  rejected: 'border-l-hs-red-500',
  sold: 'border-l-sky-500',
  delisted: 'border-l-gray-300',
}

export function ListingCard({
  id,
  title,
  type,
  status,
  askingPrice,
  coverPhotoUrl,
  viewCount,
  inquiryCount,
  rejectionReason,
  createdAt,
}: ListingCardProps) {
  const formattedPrice = formatUsdCents(askingPrice)

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(createdAt))

  return (
    <div className={`group bg-white rounded-xl border border-gray-200 border-l-4 ${STATUS_BORDER[status]} overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-gray-300`}>
      {/* Rejection banner */}
      {status === 'rejected' && rejectionReason && (
        <div className="bg-hs-red-50 border-b border-hs-red-100 px-4 py-3">
          <p className="text-sm text-hs-red-800">
            <span className="font-semibold">Rejected:</span> {rejectionReason}
          </p>
          <Link
            href={`/seller/listings/${id}/edit`}
            className="inline-flex items-center gap-1 mt-1.5 text-sm font-semibold text-hs-red-700 hover:text-hs-red-800 hover:underline underline-offset-2 transition-colors min-h-[44px] py-2"
          >
            Edit to resubmit
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}

      {/* Draft banner */}
      {status === 'draft' && (
        <div className="bg-gray-50 border-b border-gray-100 px-4 py-2.5">
          <Link
            href={`/seller/listings/${id}/edit`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors min-h-[44px] py-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Continue editing this draft
          </Link>
        </div>
      )}

      <Link href={`/seller/listings/${id}`} className="block">
        {/* Cover photo */}
        <div className="aspect-[4/3] bg-gray-100 relative overflow-hidden">
          {coverPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverPhotoUrl}
              alt=""
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <ImagePlaceholder className="w-full h-full" text="No photo" />
          )}

          {/* Type badge */}
          <div className="absolute top-3 left-3">
            <span className="inline-flex items-center px-2.5 py-1 bg-white/90 backdrop-blur-sm text-gray-700 text-xs font-semibold rounded-lg shadow-sm">
              {typeLabels[type]}
            </span>
          </div>

          {/* Status badge */}
          <div className="absolute top-3 right-3">
            <StatusBadge status={status} size="md" />
          </div>
        </div>

        {/* Details */}
        <div className="p-4">
          <h3 className="font-semibold text-gray-900 truncate group-hover:text-hs-red-600 transition-colors">
            {title}
          </h3>

          <p className="text-2xl font-bold text-hs-red-600 mt-2 tracking-tight">
            {formattedPrice}
          </p>

          <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {viewCount} views
            </span>
            <span className="inline-flex items-center gap-1">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              {inquiryCount} inquiries
            </span>
          </div>

          <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-100">
            Listed {formattedDate}
          </p>
        </div>
      </Link>
    </div>
  )
}

// Compact variant for list views
export function ListingCardCompact({
  id,
  title,
  type,
  status,
  askingPrice,
  coverPhotoUrl,
  createdAt,
}: Omit<ListingCardProps, 'viewCount' | 'inquiryCount' | 'rejectionReason'>) {
  const formattedPrice = formatUsdCents(askingPrice)

  return (
    <Link
      href={`/seller/listings/${id}`}
      className="group flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all duration-200 min-h-[44px]"
    >
      {/* Thumbnail */}
      <div className="w-20 h-20 bg-gray-100 rounded-lg flex-shrink-0 overflow-hidden">
        {coverPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverPhotoUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <ImagePlaceholder className="w-full h-full" />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {typeLabels[type]}
          </span>
          <StatusBadge status={status} size="sm" />
        </div>
        <h3 className="font-semibold text-gray-900 truncate group-hover:text-hs-red-600 transition-colors">
          {title}
        </h3>
        <p className="text-lg font-bold text-hs-red-600">{formattedPrice}</p>
      </div>

      {/* Arrow */}
      <svg
        className="h-5 w-5 text-gray-400 group-hover:text-hs-red-600 group-hover:translate-x-1 transition-all flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  )
}
