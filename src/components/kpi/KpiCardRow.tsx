'use client'

import { useState } from 'react'
import type { KpiData } from '@/lib/kpi/schema'
import { kpiBadge } from '@/lib/kpi/badges'
import { KpiCard } from './KpiCard'
import { KpiTrendModal } from './KpiTrendModal'

interface KpiCardRowProps {
  kpiData: KpiData
}

// KPI display configuration
const KPI_CONFIG = [
  {
    key: 'revenue' as const,
    name: 'Revenue',
    format: (v: number) =>
      `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
  },
  {
    key: 'newClients' as const,
    name: 'New Clients',
    format: (v: number) => v.toLocaleString('en-US'),
  },
  {
    key: 'bookings' as const,
    name: 'Bookings',
    format: (v: number) => v.toLocaleString('en-US'),
  },
  {
    key: 'membershipConversion' as const,
    name: 'Membership Conversion',
    format: (v: number) => `${(v * 100).toFixed(1)}%`,
  },
] as const

type KpiKey = (typeof KPI_CONFIG)[number]['key']

const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

export function KpiCardRow({ kpiData }: KpiCardRowProps) {
  const [selectedKpi, setSelectedKpi] = useState<KpiKey | null>(null)

  // Filter to only KPIs that have data
  const availableKpis = KPI_CONFIG.filter((config) => kpiData[config.key])

  // Dynamic grid columns based on available KPIs
  const gridCols = GRID_COLS[availableKpis.length] ?? 'grid-cols-4'

  const selectedConfig = selectedKpi
    ? KPI_CONFIG.find((c) => c.key === selectedKpi)
    : null
  const selectedMetric = selectedKpi ? kpiData[selectedKpi] : null

  return (
    <>
      <div className={`grid ${gridCols} gap-6`}>
        {availableKpis.map((config) => {
          const metric = kpiData[config.key]!
          return (
            <KpiCard
              key={config.key}
              name={config.name}
              metric={metric}
              formatValue={config.format}
              onClick={() => setSelectedKpi(config.key)}
              badge={kpiBadge(config.key, metric)}
            />
          )
        })}
      </div>

      {/* Trend modal */}
      {selectedConfig && selectedMetric && (
        <KpiTrendModal
          isOpen={selectedKpi !== null}
          onClose={() => setSelectedKpi(null)}
          title={selectedConfig.name}
          metric={selectedMetric}
          formatValue={selectedConfig.format}
        />
      )}
    </>
  )
}
