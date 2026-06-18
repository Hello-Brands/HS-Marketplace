import "server-only"
import { unstable_cache } from "next/cache"
import { runQuery } from "./client"

type NetSalesRow = { LOCATION_NAME: string | null; cash_plus_credit: number | null }
type McrRow = { LOCATION_NAME: string | null; mcr_pct: number | null }
type NameRow = { LOCATION_NAME: string | null }

const NET_SALES_SQL = `
  SELECT LOCATION_NAME, ROUND(SUM(TRANSACTION_AMOUNT), 2) AS cash_plus_credit
  FROM \`even-affinity-388602.snowflake_data.vw_order_payments_raw\`
  WHERE CREATED_ON >= DATE_TRUNC(CURRENT_DATE(), YEAR)
  GROUP BY LOCATION_NAME
  ORDER BY cash_plus_credit DESC`

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

/** Pure: dollars → integer cents, keyed by LOCATION_NAME. Exported for tests. */
export function rowsToNetSalesMap(rows: NetSalesRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!r.LOCATION_NAME) continue
    map.set(r.LOCATION_NAME, Math.round((r.cash_plus_credit ?? 0) * 100))
  }
  return map
}

/** Pure: mcr_pct as a number, keyed by LOCATION_NAME. Exported for tests. */
export function rowsToMcrMap(rows: McrRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!r.LOCATION_NAME) continue
    map.set(r.LOCATION_NAME, r.mcr_pct ?? 0)
  }
  return map
}

const cachedNetSales = unstable_cache(
  async () => {
    const rows = await runQuery<NetSalesRow>(NET_SALES_SQL)
    return Array.from(rowsToNetSalesMap(rows ?? []).entries())
  },
  ["bq-net-sales-ytd"],
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

export async function getNetSalesByLocation(): Promise<Map<string, number>> {
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
