'use client'

import Link from 'next/link'
import { RequestStatusBadge } from '@/components/brand-requests/RequestStatusBadge'
import type { BrandRecon, BrandRequestStatus } from '@/db/schema/brandRequests'

/**
 * Admin brand-request queue table — mirrors ListingsTable.tsx (client table,
 * detail links, same cell/typography scale) minus the row actions: every
 * decision lives on the detail page next to the recon estimate.
 */

export interface BrandRequestRow {
  id: string
  brandName: string
  normalizedDomain: string
  status: BrandRequestStatus
  recon: BrandRecon | null
  locationsFound: number | null
  error: string | null
  createdAt: Date
  submitterName: string | null
  submitterEmail: string | null
}

interface BrandRequestsTableProps {
  requests: BrandRequestRow[]
}

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Denver',
  }).format(new Date(date))

export function BrandRequestsTable({ requests }: BrandRequestsTableProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Brand
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Domain
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Submitter
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Locations
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Requested
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {requests.map((request) => {
              // locationsFound is the built brand's real count; the recon
              // estimate is the best stand-in until the build runs.
              const locations =
                request.locationsFound ?? request.recon?.estLocationCount ?? null

              return (
                <tr key={request.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/brand-requests/${request.id}`}
                        className="font-medium text-gray-900 hover:text-hs-red-600"
                      >
                        {request.brandName}
                      </Link>
                      {request.error && (
                        <span
                          title={request.error}
                          aria-label={`Pipeline error: ${request.error}`}
                          className="inline-block h-2 w-2 flex-shrink-0 rounded-full bg-amber-500"
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-500">
                    {request.normalizedDomain}
                  </td>
                  <td className="px-4 py-4">
                    <p className="text-sm text-gray-900">
                      {request.submitterName || request.submitterEmail || 'Unknown'}
                    </p>
                    {request.submitterName && request.submitterEmail && (
                      <p className="text-sm text-gray-500">{request.submitterEmail}</p>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <RequestStatusBadge status={request.status} audience="admin" />
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-500">
                    {locations ?? '—'}
                  </td>
                  <td className="px-4 py-4 text-sm text-gray-500">
                    {formatDate(request.createdAt)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
