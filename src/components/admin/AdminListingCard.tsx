'use client'

import Link from 'next/link'
import { StatusBadge } from '@/components/listings/StatusBadge'
import { formatUsdCents } from '@/lib/money'
import type { ListingStatus, ListingType } from '@/lib/listings/types'

interface AdminListingCardProps {
  id: string
  title: string
  type: ListingType
  status: ListingStatus
  askingPrice: number
  coverPhotoUrl?: string
  sellerName: string
  sellerEmail: string
  createdAt: Date
  locations: { name: string; city?: string; state?: string }[]
  onApprove?: () => void
  onReject?: () => void
  isProcessing?: boolean
}

export function AdminListingCard({
  id,
  title,
  type,
  status,
  askingPrice,
  coverPhotoUrl,
  sellerName,
  sellerEmail,
  createdAt,
  locations,
  onApprove,
  onReject,
  isProcessing,
}: AdminListingCardProps) {
  const formattedPrice = formatUsdCents(askingPrice)

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(createdAt))

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="flex flex-col sm:flex-row">
        {/* Photo */}
        <div className="w-full h-40 sm:w-32 sm:h-32 bg-gray-100 flex-shrink-0">
          {coverPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverPhotoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
              No photo
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 p-4">
          <div>
            <div className="flex items-center gap-2">
              <Link href={`/admin/listings/${id}`} className="font-medium text-gray-900 hover:text-hs-red-600">
                {title}
              </Link>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-gray-500 capitalize">{type}</p>
            <p className="text-lg font-bold text-hs-red-600">{formattedPrice}</p>
          </div>

          <div className="mt-2 text-sm text-gray-500">
            <p><span className="font-medium">Seller:</span> {sellerName} ({sellerEmail})</p>
            <p><span className="font-medium">Locations:</span> {locations.map(l => `${l.name}${l.city ? `, ${l.city}` : ''}`).join(' • ')}</p>
            <p><span className="font-medium">Submitted:</span> {formattedDate}</p>
          </div>

          {/* Actions */}
          {status === 'pending' && onApprove && onReject && (
            <div className="mt-3 flex gap-2 sm:justify-end">
              <button
                onClick={onApprove}
                disabled={isProcessing}
                className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
              >
                Approve
              </button>
              <button
                onClick={onReject}
                disabled={isProcessing}
                className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 bg-hs-red-600 text-white rounded-lg text-sm font-medium hover:bg-hs-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
