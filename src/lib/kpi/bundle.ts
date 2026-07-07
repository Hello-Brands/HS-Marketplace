import type { KpiMetric } from "./schema"
import { buildMetricFromTrend } from "./metric"

export interface BundleLocationKpi {
  id: string
  name: string
  netSales: KpiMetric | null
  membership: KpiMetric | null
}

export interface BundleAggregate {
  netSales: KpiMetric | null
  membership: KpiMetric | null
}

type Mode = "sum" | "average"

// Merge monthly trends across locations. A Map preserves first-seen order, and
// each location's trend is already chronological, so we must NOT re-sort by
// label (labels like "Jan 2025" do not sort chronologically as strings).
function mergeTrend(metrics: KpiMetric[], mode: Mode): { month: string; value: number }[] {
  const acc = new Map<string, { total: number; count: number }>()
  for (const m of metrics) {
    for (const point of m.trend) {
      const e = acc.get(point.month) ?? { total: 0, count: 0 }
      e.total += point.value
      e.count += 1
      acc.set(point.month, e)
    }
  }
  return Array.from(acc.entries()).map(([month, e]) => ({
    month,
    value: mode === "sum" ? e.total : e.total / e.count,
  }))
}

function aggregateOne(metrics: KpiMetric[], mode: Mode): KpiMetric | null {
  if (metrics.length === 0) return null
  const total = metrics.reduce((s, m) => s + m.lastMonth, 0)
  const lastMonth = mode === "sum" ? total : total / metrics.length
  const trend = mergeTrend(metrics, mode)
  const updatedAt = metrics.map((m) => m.updatedAt).sort().pop()!
  return buildMetricFromTrend(trend, { lastMonth, updatedAt })
}

export function aggregateBundleLocationKpis(locations: BundleLocationKpi[]): BundleAggregate {
  const net = locations.map((l) => l.netSales).filter((m): m is KpiMetric => m !== null)
  const mem = locations.map((l) => l.membership).filter((m): m is KpiMetric => m !== null)
  return {
    netSales: aggregateOne(net, "sum"),
    membership: aggregateOne(mem, "average"),
  }
}
