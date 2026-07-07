'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StatusBadge } from '@/components/listings/StatusBadge'
import { ConfirmDialog } from './ConfirmDialog'
import { adminMarkSold } from '@/lib/admin/actions'
import { formatUsdCents } from '@/lib/money'
import type { ListingStatus, ListingType } from '@/lib/listings/types'

interface Listing {
  id: string
  title: string | null
  type: ListingType
  status: ListingStatus
  askingPrice: number
  viewCount: number
  inquiryCount: number
  createdAt: Date
  updatedAt: Date
  locations: { name: string; city: string | null; state: string | null }[]
  seller: { name: string | null; email: string | null }
}

interface ListingsTableProps {
  listings: Listing[]
}

export function ListingsTable({ listings }: ListingsTableProps) {
  const router = useRouter()
  const [processing, setProcessing] = useState<string | null>(null)
  const [confirmSoldId, setConfirmSoldId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filteredListings = useMemo(() => {
    if (!search.trim()) return listings
    const q = search.toLowerCase()
    return listings.filter((listing) => {
      const title = (listing.title ?? '').toLowerCase()
      const sellerName = (listing.seller.name ?? '').toLowerCase()
      const sellerEmail = (listing.seller.email ?? '').toLowerCase()
      const locationNames = listing.locations
        .map((l) => l.name.toLowerCase())
        .join(' ')
      const cities = listing.locations
        .map((l) => (l.city ?? '').toLowerCase())
        .join(' ')
      const states = listing.locations
        .map((l) => (l.state ?? '').toLowerCase())
        .join(' ')

      return (
        title.includes(q) ||
        sellerName.includes(q) ||
        sellerEmail.includes(q) ||
        locationNames.includes(q) ||
        cities.includes(q) ||
        states.includes(q)
      )
    })
  }, [listings, search])

  const handleMarkSold = async () => {
    if (!confirmSoldId) return
    setProcessing(confirmSoldId)
    try {
      await adminMarkSold(confirmSoldId)
      router.refresh()
    } catch (error) {
      alert((error as Error).message)
    } finally {
      setProcessing(null)
      setConfirmSoldId(null)
    }
  }

  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/Denver',
    }).format(new Date(date))

  const confirmListing = listings.find((l) => l.id === confirmSoldId)

  return (
    <>
      {/* Search input */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by title, location, city, or seller..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-hs-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
        />
        {search.trim() && (
          <p className="mt-1.5 text-xs text-gray-500">
            {filteredListings.length} of {listings.length} listing
            {listings.length !== 1 ? 's' : ''} match
          </p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Listing
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Seller
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Price
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Stats
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredListings.map((listing) => (
                <tr key={listing.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <Link
                      href={`/admin/listings/${listing.id}`}
                      className="font-medium text-gray-900 hover:text-hs-red-600"
                    >
                      {listing.title || 'Untitled'}
                    </Link>
                    <p className="text-sm capitalize text-gray-500">
                      {listing.type}
                    </p>
                    {listing.locations.length > 0 && (
                      <p className="mt-0.5 text-xs text-gray-400">
                        {listing.locations
                          .map(
                            (l) =>
                              `${l.name}${l.city ? `, ${l.city}` : ''}`
                          )
                          .join(' + ')}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-sm text-gray-900">
                      {listing.seller.name || 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {listing.seller.email}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge status={listing.status} />
                  </td>
                  <td className="px-4 py-4 font-medium text-gray-900">
                    {formatUsdCents(listing.askingPrice)}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-500">
                    {listing.viewCount} views &bull; {listing.inquiryCount}{' '}
                    inquiries
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-500">
                    {formatDate(listing.createdAt)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/admin/listings/${listing.id}/edit`}
                        className="text-sm text-gray-600 hover:text-gray-900"
                      >
                        Edit
                      </Link>
                      {listing.status === 'active' && (
                        <button
                          onClick={() => setConfirmSoldId(listing.id)}
                          disabled={processing === listing.id}
                          className="text-sm text-green-600 hover:text-green-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
                        >
                          Mark Sold
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredListings.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-gray-500"
                  >
                    No listings match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!confirmSoldId}
        title="Mark as Sold"
        message={`Are you sure you want to mark "${confirmListing?.title || 'this listing'}" as sold? This action cannot be undone.`}
        confirmLabel="Mark Sold"
        variant="warning"
        onConfirm={handleMarkSold}
        onCancel={() => setConfirmSoldId(null)}
        isProcessing={!!processing}
      />
    </>
  )
}
