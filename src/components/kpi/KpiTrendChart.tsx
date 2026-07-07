'use client'

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { KpiMonth } from '@/lib/kpi/schema'
import { BRAND } from '@/lib/brand-colors'

interface KpiTrendChartProps {
  data: KpiMonth[]
  label: string
  formatValue: (value: number) => string
  height?: number
}

export function KpiTrendChart({
  data,
  label,
  formatValue,
  height = 240,
}: KpiTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={BRAND.border} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 12, fill: BRAND.taupe }}
          tickLine={{ stroke: BRAND.border }}
          axisLine={{ stroke: BRAND.border }}
        />
        <YAxis
          tick={{ fontSize: 12, fill: BRAND.taupe }}
          tickLine={{ stroke: BRAND.border }}
          axisLine={{ stroke: BRAND.border }}
          tickFormatter={(value) => formatValue(value)}
        />
        <Tooltip
          content={({ active, payload, label: month }) => {
            if (!active || !payload?.length) return null
            const value = payload[0].value as number
            return (
              <div
                className="rounded-md border border-gray-200 bg-white px-3 py-2 shadow-md"
                style={{ fontSize: '14px' }}
              >
                <span className="font-medium">{formatValue(value)}</span>
                <span className="text-gray-500"> &bull; {month}</span>
              </div>
            )
          }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={BRAND.crimson}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: BRAND.crimson }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
