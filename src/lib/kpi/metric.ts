import type { KpiMetric } from "./schema"

type TrendPoint = { month: string; value: number }

/**
 * Build a KpiMetric from a chronological trend (DEBT-012). Derives last / prior /
 * month-over-month change from the trend's tail and wraps it in the standard
 * `{ updatedAt, source: "bigquery" }` envelope — the shape that was copy-pasted
 * across the single-location and bundle KPI paths.
 *
 * - `lastMonth` defaults to the trend's last value; pass an override when the
 *   headline differs from the series (e.g. revenue shows a TTM dollar total, or a
 *   bundle aggregate shows a sum/average across locations).
 * - `updatedAt` defaults to now; pass an override to carry the freshest source
 *   timestamp (e.g. bundle aggregation reuses the newest location's timestamp).
 */
export function buildMetricFromTrend(
  trend: TrendPoint[],
  opts?: { lastMonth?: number; updatedAt?: string },
): KpiMetric {
  const last = trend.length > 0 ? trend[trend.length - 1].value : 0
  const prior = trend.length > 1 ? trend[trend.length - 2].value : 0
  const momChange = prior !== 0 ? (last - prior) / prior : 0

  return {
    lastMonth: opts?.lastMonth ?? last,
    momChange,
    trend,
    updatedAt: opts?.updatedAt ?? new Date().toISOString(),
    source: "bigquery",
  }
}
