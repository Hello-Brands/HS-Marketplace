'use client'

import { useState, useEffect } from 'react'
import type { LocationSelection } from '@/lib/listings/types'
import { getSellerLocations } from '@/lib/listings/seller-locations'

interface LocationSelectorProps {
  value: LocationSelection[]
  onChange: (locations: LocationSelection[]) => void
  userId: string
}

export function LocationSelector({ value, onChange, userId }: LocationSelectorProps) {
  const [available, setAvailable] = useState<LocationSelection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSellerLocations(userId).then(locations => {
      setAvailable(locations)
      setLoading(false)
    })
  }, [userId])

  const toggleLocation = (loc: LocationSelection) => {
    const isSelected = value.some(v => v.id === loc.id)
    if (isSelected) {
      onChange(value.filter(v => v.id !== loc.id))
    } else {
      onChange([...value, loc])
    }
  }

  if (loading) {
    return <div className="animate-pulse h-32 bg-gray-100 rounded-lg" />
  }

  if (available.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-200 p-6 text-center">
        <p className="text-sm font-medium text-gray-900">
          No locations found for your account
        </p>
        <p className="mt-1 text-sm text-gray-500">
          Contact{' '}
          <a
            href="mailto:support@hellosugar.salon"
            className="text-hs-red-600 underline hover:text-hs-red-700"
          >
            support@hellosugar.salon
          </a>{' '}
          to get your locations linked.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Select one or more locations. Selecting multiple creates a bundle listing.
      </p>
      <div className="grid gap-3">
        {available.map(loc => {
          const isSelected = value.some(v => v.id === loc.id)
          const cityState = [loc.city, loc.state].filter(Boolean).join(', ')
          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => toggleLocation(loc)}
              className={`
                p-4 rounded-lg border-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                ${isSelected
                  ? 'border-hs-red-600 bg-hs-red-50'
                  : 'border-gray-200 hover:border-gray-300'
                }
              `}
            >
              <div className="font-medium">{loc.name}</div>
              {loc.address && (
                <div className="text-sm text-gray-500">{loc.address}</div>
              )}
              {(cityState || loc.squareFootage != null) && (
                <div className="text-sm text-gray-500">
                  {[cityState, loc.squareFootage != null ? `${loc.squareFootage} sq ft` : null]
                    .filter(Boolean)
                    .join(' • ')}
                </div>
              )}
              {loc.ttmRevenue != null && (
                <div className="text-sm text-gray-500">
                  TTM Revenue: ${(loc.ttmRevenue / 100).toLocaleString()}
                </div>
              )}
            </button>
          )
        })}
      </div>
      {value.length > 1 && (
        <p className="text-sm text-hs-red-600 font-medium">
          Bundle listing: {value.length} locations selected
        </p>
      )}
    </div>
  )
}
