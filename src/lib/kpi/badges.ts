import type { KpiData, KpiMetric } from "./schema"

export type KpiBadge = "live" | "sample" | "pending"

/** Honest per-card badge: only Boulevard-sourced revenue and MR% are "live"; the rest sample. */
export function kpiBadge(key: keyof KpiData, metric: KpiMetric): KpiBadge {
  if ((key === "revenue" || key === "membershipConversion") && metric.source === "boulevard") return "live"
  if (key === "membershipConversion") return "pending"
  return "sample"
}
