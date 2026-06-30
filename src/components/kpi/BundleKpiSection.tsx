'use client'

import { useState, useMemo, useEffect } from 'react'
import type { BundleLocationKpi } from '@/lib/kpi/bundle'
import { KpiTrendChart } from './KpiTrendChart'

interface BundleKpiSectionProps {
  locations: BundleLocationKpi[]
  territories: { id: string; name: string }[]
}

type SortKey = 'name' | 'netSales' | 'membership'
type SortDirection = 'asc' | 'desc'

const formatDollars = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const formatPct = (v: number) => `${v.toFixed(1)}%`

function SortArrow({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return null
  return <span className="ml-1 text-hs-red-600">{direction === 'asc' ? '↑' : '↓'}</span>
}

export function BundleKpiSection({ locations, territories }: BundleKpiSectionProps) {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  const sorted = useMemo(() => {
    return [...locations].sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name)
        return sortDirection === 'asc' ? cmp : -cmp
      } else {
        const av = a[sortKey]?.lastMonth
        const bv = b[sortKey]?.lastMonth
        if (av == null && bv == null) return 0
        if (av == null) return 1   // missing metric always last
        if (bv == null) return -1
        const cmp = av - bv
        return sortDirection === 'asc' ? cmp : -cmp
      }
    })
  }, [locations, sortKey, sortDirection])

  const selected = selectedId ? locations.find((l) => l.id === selectedId) ?? null : null

  // Close on Escape key
  useEffect(() => {
    if (!selected) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedId])

  return (
    <div className="mt-8 space-y-6">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('name')}>
                Location<SortArrow active={sortKey === 'name'} direction={sortDirection} />
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('netSales')}>
                Net Sales (TTM)<SortArrow active={sortKey === 'netSales'} direction={sortDirection} />
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('membership')}>
                MCR<SortArrow active={sortKey === 'membership'} direction={sortDirection} />
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sorted.map((loc) => (
              <tr
                key={loc.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => setSelectedId(loc.id)}
              >
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-hs-red-700">{loc.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {loc.netSales ? formatDollars(loc.netSales.lastMonth) : '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {loc.membership ? formatPct(loc.membership.lastMonth) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {territories.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Unopened Territories</h3>
          <ul className="list-disc list-inside text-sm text-gray-600">
            {territories.map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
          </ul>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedId(null)} aria-hidden="true" />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-8" role="dialog" aria-modal="true" aria-labelledby="bundle-location-modal-title">
            <button
              onClick={() => setSelectedId(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 id="bundle-location-modal-title" className="text-xl font-semibold text-gray-900 mb-6">{selected.name}</h3>

            <div className="space-y-8">
              <div>
                <p className="text-sm text-gray-500 mb-1">Net Sales (TTM · Cash + Credit)</p>
                <p className="text-3xl font-semibold text-gray-900 mb-3">
                  {selected.netSales ? formatDollars(selected.netSales.lastMonth) : '—'}
                </p>
                {selected.netSales && selected.netSales.trend.length >= 2 && (
                  <KpiTrendChart data={selected.netSales.trend} label="Net Sales" formatValue={formatDollars} height={200} />
                )}
              </div>

              <div>
                <p className="text-sm text-gray-500 mb-1">Membership Conversion</p>
                <p className="text-3xl font-semibold text-gray-900 mb-3">
                  {selected.membership ? formatPct(selected.membership.lastMonth) : '—'}
                </p>
                {selected.membership && selected.membership.trend.length >= 2 && (
                  <KpiTrendChart data={selected.membership.trend} label="MCR" formatValue={formatPct} height={200} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
