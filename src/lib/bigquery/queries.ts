import "server-only"
import { unstable_cache } from "next/cache"
import { runQuery } from "./client"

// The BigQuery SDK can return numeric columns as JS number, string, or a Big
// object (for NUMERIC/BIGNUMERIC), so accept the broad shape and coerce.
type Numeric = number | string | { toString(): string } | null
type NetSalesRow = { LOCATION_NAME: string | null; sales_month: string | null; cash_plus_credit: Numeric }
export type LocationNetSales = { totalCents: number; trend: { month: string; value: number }[] }
type McrRow = { LOCATION_NAME: string | null; mcr_pct: Numeric }
type McrTrendRow = { LOCATION_NAME: string | null; mcr_month: string | null; mcr_pct: Numeric }
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
  WHERE APPOINTMENT_DATE >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
    AND APPOINTMENT_DATE < DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY LOCATION_NAME
  ORDER BY mcr_pct DESC`

const MCR_TREND_SQL = `
  SELECT LOCATION_NAME,
    FORMAT_DATE('%Y-%m', DATE_TRUNC(APPOINTMENT_DATE, MONTH)) AS mcr_month,
    ROUND(SAFE_DIVIDE(SUM(NON_LASER_NEW_MEMBERS), SUM(NON_LASER_PROSPECTS)) * 100, 1) AS mcr_pct
  FROM \`even-affinity-388602.data_mart_for_tools.vw_mcr_data_agg_raw\`
  WHERE APPOINTMENT_DATE >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
    AND APPOINTMENT_DATE < DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY LOCATION_NAME, mcr_month
  ORDER BY LOCATION_NAME, mcr_month`

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

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-")
  const idx = Number(m) - 1
  return MONTH_ABBR[idx] ? `${MONTH_ABBR[idx]} ${y}` : ym
}

/** Pure: monthly rows → per-location { totalCents, trend (dollars, sorted asc) }. Exported for tests. */
export function rowsToNetSalesByLocation(rows: NetSalesRow[]): Map<string, LocationNetSales> {
  // Accumulate with raw "YYYY-MM" key for correct chronological sorting
  const raw = new Map<string, { totalCents: number; trend: { rawMonth: string; value: number }[] }>()
  for (const r of rows) {
    if (!r.LOCATION_NAME || !r.sales_month) continue
    const dollars = toNumber(r.cash_plus_credit)
    const entry = raw.get(r.LOCATION_NAME) ?? { totalCents: 0, trend: [] }
    entry.totalCents += Math.round(dollars * 100)
    entry.trend.push({ rawMonth: r.sales_month, value: dollars })
    raw.set(r.LOCATION_NAME, entry)
  }
  // Sort by raw "YYYY-MM" (chronological), then convert month to display label
  const map = new Map<string, LocationNetSales>()
  for (const [name, entry] of raw.entries()) {
    entry.trend.sort((a, b) => a.rawMonth.localeCompare(b.rawMonth))
    map.set(name, {
      totalCents: entry.totalCents,
      trend: entry.trend.map(({ rawMonth, value }) => ({ month: formatMonthLabel(rawMonth), value })),
    })
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

/**
 * Pure: monthly MCR rows → per-location sorted { month label, pct } trend.
 * Drops zero-prospect (null mcr_pct) months; keeps a legitimate 0. Exported for tests.
 */
export function rowsToMcrTrendByLocation(
  rows: McrTrendRow[]
): Map<string, { month: string; value: number }[]> {
  // Accumulate with raw "YYYY-MM" key for correct chronological sorting
  const raw = new Map<string, { rawMonth: string; value: number }[]>()
  for (const r of rows) {
    if (!r.LOCATION_NAME || !r.mcr_month || r.mcr_pct === null || r.mcr_pct === undefined) continue
    const arr = raw.get(r.LOCATION_NAME) ?? []
    arr.push({ rawMonth: r.mcr_month, value: toNumber(r.mcr_pct) })
    raw.set(r.LOCATION_NAME, arr)
  }
  const map = new Map<string, { month: string; value: number }[]>()
  for (const [name, arr] of raw.entries()) {
    arr.sort((a, b) => a.rawMonth.localeCompare(b.rawMonth))
    map.set(name, arr.map(({ rawMonth, value }) => ({ month: formatMonthLabel(rawMonth), value })))
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
  ["bq-mcr-ttm"],
  { revalidate: 86400, tags: ["bq-mcr"] }
)

export async function getNetSalesByLocation(): Promise<Map<string, LocationNetSales>> {
  return new Map(await cachedNetSales())
}

export async function getMcrByLocation(): Promise<Map<string, number>> {
  return new Map(await cachedMcr())
}

const cachedMcrTrend = unstable_cache(
  async () => {
    const rows = await runQuery<McrTrendRow>(MCR_TREND_SQL)
    return Array.from(rowsToMcrTrendByLocation(rows ?? []).entries())
  },
  ["bq-mcr-trend-ttm"],
  { revalidate: 86400, tags: ["bq-mcr-trend"] }
)

export async function getMcrTrendByLocation(): Promise<Map<string, { month: string; value: number }[]>> {
  return new Map(await cachedMcrTrend())
}

export async function listLocationNames(): Promise<string[] | null> {
  const rows = await runQuery<NameRow>(NAMES_SQL)
  if (rows === null) return null
  return rows.map((r) => r.LOCATION_NAME).filter((n): n is string => !!n)
}

// ---- Reviews -------------------------------------------------------------

export type FeaturedReview = {
  reviewerName: string
  rating: number
  date: string // "YYYY-MM-DD"
  comment: string
  ownerReplied: boolean
}

export type LocationReviewSummary = {
  avgRating: number
  totalReviews: number
  distribution: { stars: 1 | 2 | 3 | 4 | 5; count: number }[] // ordered 5,4,3,2,1
  featured: FeaturedReview | null
}

// One row per candidate review (top 8 per location), carrying per-location
// aggregates as repeated window columns. create_date is pre-formatted to a
// plain "YYYY-MM-DD" string in SQL so we never touch BigQueryDate objects.
type ReviewSummaryRow = {
  LOCATION_NAME: string | null
  avg_rating: Numeric
  total_reviews: Numeric
  c1: Numeric
  c2: Numeric
  c3: Numeric
  c4: Numeric
  c5: Numeric
  REVIEWER_DISPLAY_NAME: string | null
  NUMERIC_STAR_RATING: Numeric
  COMMENT: string | null
  create_date: string | null
  REPLIED: boolean | null
}

const REVIEW_SUMMARY_SQL = `
  WITH base AS (
    SELECT
      LOCATION_NAME,
      NUMERIC_STAR_RATING,
      COMMENT,
      REVIEWER_DISPLAY_NAME,
      FORMAT_DATE('%Y-%m-%d', CREATE_DATE) AS create_date,
      REPLIED,
      AVG(NUMERIC_STAR_RATING) OVER (PARTITION BY LOCATION_NAME) AS avg_rating,
      COUNT(*) OVER (PARTITION BY LOCATION_NAME) AS total_reviews,
      COUNTIF(NUMERIC_STAR_RATING = 1) OVER (PARTITION BY LOCATION_NAME) AS c1,
      COUNTIF(NUMERIC_STAR_RATING = 2) OVER (PARTITION BY LOCATION_NAME) AS c2,
      COUNTIF(NUMERIC_STAR_RATING = 3) OVER (PARTITION BY LOCATION_NAME) AS c3,
      COUNTIF(NUMERIC_STAR_RATING = 4) OVER (PARTITION BY LOCATION_NAME) AS c4,
      COUNTIF(NUMERIC_STAR_RATING = 5) OVER (PARTITION BY LOCATION_NAME) AS c5,
      ROW_NUMBER() OVER (
        PARTITION BY LOCATION_NAME
        ORDER BY (COMMENT IS NOT NULL AND TRIM(COMMENT) != '') DESC,
                 NUMERIC_STAR_RATING DESC,
                 CREATE_DATE DESC
      ) AS rn
    FROM \`even-affinity-388602.snowflake_data.vw_review_account_location_view_raw\`
    WHERE LOCATION_NAME IS NOT NULL
      AND NUMERIC_STAR_RATING BETWEEN 1 AND 5
  )
  SELECT
    LOCATION_NAME, avg_rating, total_reviews, c1, c2, c3, c4, c5,
    REVIEWER_DISPLAY_NAME, NUMERIC_STAR_RATING, COMMENT, create_date, REPLIED
  FROM base
  WHERE rn <= 8
  ORDER BY LOCATION_NAME, rn`

/**
 * Pure: pick one featured review from comment-bearing candidates.
 * Order: rating desc -> 120-600 char window preferred -> owner-replied preferred
 * -> most recent. Relaxes the length window when nothing falls inside it.
 * Exported for tests.
 */
export function pickFeaturedReview(candidates: FeaturedReview[]): FeaturedReview | null {
  const eligible = candidates.filter((c) => c.comment.trim().length > 0)
  if (eligible.length === 0) return null

  const inWindow = (c: FeaturedReview) => c.comment.length >= 120 && c.comment.length <= 600

  const sorted = [...eligible].sort(
    (a, b) =>
      b.rating - a.rating ||
      (Number(inWindow(b)) - Number(inWindow(a))) ||
      (a.ownerReplied === b.ownerReplied ? 0 : a.ownerReplied ? -1 : 1) ||
      b.date.localeCompare(a.date)
  )
  return sorted[0]
}

/** Pure: candidate rows -> per-location summary map. Exported for tests. */
export function rowsToReviewSummaryByLocation(
  rows: ReviewSummaryRow[]
): Map<string, LocationReviewSummary> {
  const grouped = new Map<string, ReviewSummaryRow[]>()
  for (const r of rows) {
    if (!r.LOCATION_NAME) continue
    const arr = grouped.get(r.LOCATION_NAME) ?? []
    arr.push(r)
    grouped.set(r.LOCATION_NAME, arr)
  }

  const map = new Map<string, LocationReviewSummary>()
  for (const [name, group] of grouped.entries()) {
    const head = group[0]
    const candidates: FeaturedReview[] = group
      .filter((r) => r.COMMENT && r.COMMENT.trim().length > 0)
      .map((r) => ({
        reviewerName: r.REVIEWER_DISPLAY_NAME ?? "Google reviewer",
        rating: toNumber(r.NUMERIC_STAR_RATING),
        date: r.create_date ?? "",
        comment: r.COMMENT as string,
        ownerReplied: r.REPLIED === true,
      }))

    map.set(name, {
      avgRating: toNumber(head.avg_rating),
      totalReviews: toNumber(head.total_reviews),
      distribution: [
        { stars: 5, count: toNumber(head.c5) },
        { stars: 4, count: toNumber(head.c4) },
        { stars: 3, count: toNumber(head.c3) },
        { stars: 2, count: toNumber(head.c2) },
        { stars: 1, count: toNumber(head.c1) },
      ],
      featured: pickFeaturedReview(candidates),
    })
  }
  return map
}

const cachedReviewSummary = unstable_cache(
  async () => {
    const rows = await runQuery<ReviewSummaryRow>(REVIEW_SUMMARY_SQL)
    return Array.from(rowsToReviewSummaryByLocation(rows ?? []).entries())
  },
  ["bq-review-summary"],
  { revalidate: 86400, tags: ["bq-reviews"] }
)

export async function getReviewSummaryByLocation(): Promise<Map<string, LocationReviewSummary>> {
  return new Map(await cachedReviewSummary())
}
