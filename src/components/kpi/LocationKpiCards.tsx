'use client'

import { useState } from 'react'
import type { KpiMetric } from '@/lib/kpi/schema'
import { KpiCard } from './KpiCard'
import { KpiTrendModal } from './KpiTrendModal'

interface LocationKpiCardsProps {
  netSales: KpiMetric | null
  membership: KpiMetric | null
  membershipLabel?: string
}

type SlotKey = 'netSales' | 'membership'

const formatDollars = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const formatPct = (v: number) => `${v.toFixed(1)}%`

// Card label is tight; the trend modal shows the full descriptive phrase.
const SLOTS = [
  {
    key: 'netSales' as const,
    cardLabel: 'Net Sales (TTM · Cash + Credit)',
    modalTitle: 'Net Sales (Trailing 12 Months, Cash + Credit)',
    format: formatDollars,
  },
  {
    key: 'membership' as const,
    cardLabel: 'Membership Conversion',
    modalTitle: 'Membership Conversion',
    format: formatPct,
  },
] as const

function PlaceholderCard({ label }: { label: string }) {
  return (
    <div className="relative min-h-[120px] rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-normal text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-3xl font-semibold text-gray-300 mb-2">—</p>
      <p className="text-xs text-gray-400">Not connected</p>
    </div>
  )
}

export function LocationKpiCards({ netSales, membership, membershipLabel }: LocationKpiCardsProps) {
  const [open, setOpen] = useState<SlotKey | null>(null)

  const metrics: Record<SlotKey, KpiMetric | null> = { netSales, membership }
  const openSlot = open ? SLOTS.find((s) => s.key === open)! : null
  const openMetric = open ? metrics[open] : null

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {SLOTS.map((slot) => {
          const metric = metrics[slot.key]
          const label = slot.key === 'membership' && membershipLabel ? membershipLabel : slot.cardLabel
          if (!metric) return <PlaceholderCard key={slot.key} label={label} />
          return (
            <KpiCard
              key={slot.key}
              name={label}
              metric={metric}
              formatValue={slot.format}
              onClick={() => setOpen(slot.key)}
              badge="live"
              showDelta={false}
            />
          )
        })}
      </div>

      {openSlot && openMetric && (
        <KpiTrendModal
          isOpen={open !== null}
          onClose={() => setOpen(null)}
          title={openSlot.modalTitle}
          metric={openMetric}
          formatValue={openSlot.format}
        />
      )}
    </>
  )
}
