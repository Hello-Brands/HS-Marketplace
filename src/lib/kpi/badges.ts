import type { KpiData, KpiMetric } from "./schema"

export type KpiBadge = "live" | "sample" | "pending"

/** Honest per-card badge: only Boulevard-sourced revenue is "live"; MR% is pending; the rest sample. */
export function kpiBadge(key: keyof KpiData, metric: KpiMetric): KpiBadge {
  if (key === "revenue" && metric.source === "boulevard") return "live"
  if (key === "membershipConversion") return "pending"
  return "sample"
}
