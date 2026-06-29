import type { ListingDetail } from '@/lib/listing-detail'

interface FinancialsGridProps {
  listing: ListingDetail
}

function formatPrice(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '-'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

interface MetricCardProps {
  label: string
  value: string
  subLabel?: string
  variant?: 'default' | 'primary'
}

function MetricCard({ label, value, subLabel, variant = 'default' }: MetricCardProps) {
  const isPrimary = variant === 'primary'
  return (
    <div
      className={`
        rounded-xl p-4 transition-all duration-200
        ${isPrimary
          ? 'bg-hs-red-50 border-2 border-hs-red-200'
          : 'bg-white border border-gray-200'
        }
      `}
    >
      <p className={`text-sm mb-1 ${isPrimary ? 'text-hs-red-600 font-medium' : 'text-gray-500'}`}>
        {label}
      </p>
      <p
        className={`font-bold tabular-nums ${
          isPrimary
            ? 'text-3xl text-hs-red-700'
            : 'text-2xl text-gray-900'
        }`}
      >
        {value}
      </p>
      {subLabel && (
        <p className={`text-xs mt-1 ${isPrimary ? 'text-hs-red-500' : 'text-gray-400'}`}>
          {subLabel}
        </p>
      )}
    </div>
  )
}

export function FinancialsGrid({ listing }: FinancialsGridProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricCard
          label="Asking Price"
          value={formatPrice(listing.askingPrice)}
          variant="primary"
        />
        <MetricCard
          label="TTM Profit"
          value={formatPrice(listing.ttmProfit)}
          subLabel="Trailing 12 months"
        />
      </div>

      {/* Divider */}
      {(listing.inventoryIncluded || listing.laserIncluded || listing.otherAssets) && (
        <div className="border-t border-gray-100" />
      )}

      {/* Assets included */}
      {(listing.inventoryIncluded || listing.laserIncluded || listing.otherAssets) && (
        <div className="border border-gray-200 rounded-xl p-4 bg-white">
          <p className="text-sm font-medium text-gray-700 mb-3">Included Assets</p>
          <ul className="space-y-2 text-gray-700 text-sm">
            {listing.inventoryIncluded && (
              <li className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 shrink-0">
                  <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                Inventory
              </li>
            )}
            {listing.laserIncluded && (
              <li className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 shrink-0">
                  <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                Laser device
              </li>
            )}
            {listing.otherAssets && (
              <li className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 shrink-0">
                  <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                {listing.otherAssets}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
