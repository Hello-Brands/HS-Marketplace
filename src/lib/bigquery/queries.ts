import "server-only"
import { unstable_cache } from "next/cache"
import { runQuery } from "./client"

// The BigQuery SDK can return numeric columns as JS number, string, or a Big
// object (for NUMERIC/BIGNUMERIC), so accept the broad shape and coerce.
type Numeric = number | string | { toString(): string } | null
type NetSalesRow = { LOCATION_NAME: string | null; sales_month: string | null; cash_plus_credit: Numeric }
export type LocationNetSales = { totalCents: number; trend: { month: string; value: number }[] }
type McrRow = { LOCATION_NAME: string | null; mcr_pct: Numeric }
type NameRow = { LOCATION_NAME: string | null }

const NET_SALES_SQL = `
  SELECT
    LOCATION_NAME,
    FORMAT_DATE('%Y-%m', DATE_TRUNC(CREATED_ON, MONTH)) AS sales_month,
    ROUND(SUM(TRANSACTION_AMOUNT), 2) AS cash_plus_credit
  FROM \`even-affinity-388602.snowflake_data.vw_order_payments_raw\`
  WHERE CREATED_ON >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
    AND CREATED_ON < DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY LOCATION_NAME, sales_month
  ORDER BY LOCATION_NAME, sales_month`

const MCR_SQL = `
  SELECT LOCATION_NAME,
    ROUND(SAFE_DIVIDE(SUM(NON_LASER_NEW_MEMBERS), SUM(NON_LASER_PROSPECTS)) * 100, 1) AS mcr_pct
  FROM \`even-affinity-388602.data_mart_for_tools.vw_mcr_data_agg_raw\`
  WHERE APPOINTMENT_DATE >= DATE_TRUNC(CURRENT_DATE(), YEAR)
  GROUP BY LOCATION_NAME
  ORDER BY mcr_pct DESC`

const NAMES_SQL = `
  SELECT DISTINCT LOCATION_NAME
  FROM \`even-affinity-388602.snowflake_data.vw_order_payments_raw\`
  WHERE LOCATION_NAME IS NOT NULL
  ORDER BY LOCATION_NAME`

/** Coerce a BigQuery numeric (number | string | Big | null) to a finite JS number, 0 on failure. */
function toNumber(v: Numeric): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === "number" ? v : Number(v.toString())
  return Number.isFinite(n) ? n : 0
}

/** Pure: monthly rows → per-location { totalCents, trend (dollars, sorted asc) }. Exported for tests. */
export function rowsToNetSalesByLocation(rows: NetSalesRow[]): Map<string, LocationNetSales> {
  const map = new Map<string, LocationNetSales>()
  for (const r of rows) {
    if (!r.LOCATION_NAME || !r.sales_month) continue
    const dollars = toNumber(r.cash_plus_credit)
    const entry = map.get(r.LOCATION_NAME) ?? { totalCents: 0, trend: [] }
    entry.totalCents += Math.round(dollars * 100)
    entry.trend.push({ month: r.sales_month, value: dollars })
    map.set(r.LOCATION_NAME, entry)
  }
  for (const entry of map.values()) {
    entry.trend.sort((a, b) => a.month.localeCompare(b.month))
  }
  return map
}

/** Pure: mcr_pct as a number, keyed by LOCATION_NAME. Exported for tests. */
export function rowsToMcrMap(rows: McrRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!r.LOCATION_NAME) continue
    map.set(r.LOCATION_NAME, toNumber(r.mcr_pct))
  }
  return map
}

const cachedNetSales = unstable_cache(
  async () => {
    const rows = await runQuery<NetSalesRow>(NET_SALES_SQL)
    return Array.from(rowsToNetSalesByLocation(rows ?? []).entries())
  },
  ["bq-net-sales-ttm"],
  { revalidate: 86400, tags: ["bq-net-sales"] }
)

const cachedMcr = unstable_cache(
  async () => {
    const rows = await runQuery<McrRow>(MCR_SQL)
    return Array.from(rowsToMcrMap(rows ?? []).entries())
  },
  ["bq-mcr-ytd"],
  { revalidate: 86400, tags: ["bq-mcr"] }
)

export async function getNetSalesByLocation(): Promise<Map<string, LocationNetSales>> {
  return new Map(await cachedNetSales())
}

export async function getMcrByLocation(): Promise<Map<string, number>> {
  return new Map(await cachedMcr())
}

export async function listLocationNames(): Promise<string[] | null> {
  const rows = await runQuery<NameRow>(NAMES_SQL)
  if (rows === null) return null
  return rows.map((r) => r.LOCATION_NAME).filter((n): n is string => !!n)
}
