import type { KpiData, KpiMetric } from "./schema"

/**
 * Build the single-location KPI bundle for display.
 *
 * Real metrics (Net Sales, MCR) come from BigQuery and must render even when the
 * optional base KPI fetch (internal HS API / dev mock) is unavailable — so a null
 * base degrades to {} rather than hiding the whole section. New Clients and
 * Bookings have no live source yet and are always hidden.
 */
export function buildLocationKpi(
  base: KpiData | null,
  revenue: KpiMetric | null,
  membership: KpiMetric | null
): KpiData {
  const data: KpiData = { ...(base ?? {}) }
  if (revenue) data.revenue = revenue
  if (membership) data.membershipConversion = membership
  return { ...data, newClients: undefined, bookings: undefined }
}
