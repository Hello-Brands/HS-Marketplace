import type { KpiData, KpiMetric } from "./schema"

export type KpiBadge = "live" | "sample" | "pending"

/** Honest per-card badge: only BigQuery-sourced revenue and MCR are "live". */
export function kpiBadge(key: keyof KpiData, metric: KpiMetric): KpiBadge {
  if ((key === "revenue" || key === "membershipConversion") && metric.source === "bigquery") return "live"
  if (key === "membershipConversion") return "pending"
  return "sample"
}
