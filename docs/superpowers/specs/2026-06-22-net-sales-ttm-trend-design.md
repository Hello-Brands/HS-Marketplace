# Net Sales (TTM) with Monthly Trendline + TTM MCR — Design

**Date:** 2026-06-22
**Branch:** rock-2
**Status:** Approved (design)

## Problem

The BigQuery KPI integration currently pulls **year-to-date (YTD)** aggregates: one
Net Sales value and one MCR value per location. Prince delivered new queries that
use a **trailing-12-month (TTM)** window, and the Net Sales query now returns data
**broken down by month**. This lets us:

- Show a real **past-year total** on the Net Sales card (sum the monthly values), and
- Feed a real **month-by-month trendline** into the click-through trend modal that
  already exists for KPI cards (today it's stubbed with a single `"YTD"` point).

## Prince's queries (source of truth)

**Net Sales (Cash + Credit), monthly, trailing 12 months:**
```sql
SELECT
  LOCATION_NAME,
  FORMAT_DATE('%Y-%m', DATE_TRUNC(CREATED_ON, MONTH)) AS sales_month,
  ROUND(SUM(TRANSACTION_AMOUNT), 2) AS cash_plus_credit
FROM `even-affinity-388602.snowflake_data.vw_order_payments_raw`
WHERE CREATED_ON >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
GROUP BY LOCATION_NAME, sales_month
ORDER BY LOCATION_NAME, sales_month;
```

**MCR, trailing 12 months (single aggregate per location):**
```sql
SELECT LOCATION_NAME,
       ROUND(SAFE_DIVIDE(SUM(NON_LASER_NEW_MEMBERS), SUM(NON_LASER_PROSPECTS)) * 100, 1) AS mcr_pct
FROM `even-affinity-388602.data_mart_for_tools.vw_mcr_data_agg_raw`
WHERE APPOINTMENT_DATE >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
GROUP BY LOCATION_NAME
ORDER BY mcr_pct DESC;
```

As written, both return **12 full months plus the current partial month** (Net Sales:
13 buckets; MCR: a single aggregate that includes partial-month rows).

## Decisions

1. **Exclude the partial current month entirely.** Both the headline total and the
   trendline use only the 12 completed months. Enforced in SQL by adding an upper
   bound to each query: `AND <date_col> < DATE_TRUNC(CURRENT_DATE(), MONTH)`. This keeps
   Net Sales and MCR on one identical 12-full-month window and avoids a partial month
   dragging numbers down.
2. **Card label** → `Net Sales (Trailing 12 Months, Cash + Credit)` (replaces the
   previous stakeholder-locked "Net Sales (YTD, Cash + Credit)", which is no longer
   accurate). Matches the adjacent "TTM Profit / Trailing 12 months" card.
3. **Revenue KpiCard headline = the TTM total** (Prince: "sum it … on the card");
   clicking it opens the trend modal showing the 12 monthly values.
4. **MoM arrow on the Revenue card = latest full month vs. prior full month** (option
   (a)). See Open Notes for the known ambiguity.

## Unit convention (and a bug fix)

- **Mock revenue is in dollars** (`createMetric(45230, …)` renders as "$45,230"); the
  `KpiCard` and trend chart format `metric.lastMonth` / `trend[].value` as **dollars**.
- The current BigQuery path puts **cents** into `metric.lastMonth`, so live revenue
  renders **100× too large** in the Performance Data card. This is a latent bug fixed
  here: the `KpiMetric` carries **dollars**; the **cents** total is returned separately
  for the financials card (which divides by 100 via `formatPrice`).

## Components & data flow

### 1. `src/lib/bigquery/queries.ts`
- `NET_SALES_SQL` → Prince's monthly query + the 12-full-month upper bound.
- New pure shaper `rowsToNetSalesByLocation(rows)` → `Map<LOCATION_NAME, LocationNetSales>`
  where:
  ```ts
  type LocationNetSales = {
    totalCents: number                          // Σ of 12 months, dollars→cents
    trend: { month: string; value: number }[]   // 12 sorted points, value in DOLLARS
  }
  ```
  - dollars→cents (`Math.round(dollars * 100)`) only for `totalCents`.
  - `trend[].value` stays in dollars (display unit).
  - rows sorted by `sales_month` ascending; skip null `LOCATION_NAME`.
  - reuse the existing `toNumber()` coercion for the BigQuery numeric shapes.
- `MCR_SQL` → same TTM window + the upper bound; shape unchanged (single `mcr_pct`).
- `getNetSalesByLocation()` return type changes from `Map<string, number>` to
  `Map<string, LocationNetSales>`.
- Cache keys/tags renamed `bq-net-sales-ytd`/`bq-mcr-ytd` → `…-ttm` (and the `tags`
  arrays similarly); daily `revalidate` unchanged. `unstable_cache` still serializes,
  so store `Array.from(map.entries())` and rebuild the `Map` in the wrapper.
- `listLocationNames()` unchanged.

### 2. `src/lib/kpi/fetch.ts`
- `fetchLocationRevenue(args)` return type → `{ metric: KpiMetric; totalCents: number } | null`
  (renamed from `ytdCents`). When connected and the location is present:
  - `totalCents` = `LocationNetSales.totalCents`.
  - `metric.lastMonth` = the **TTM total in dollars** (`totalCents / 100`).
  - `metric.trend` = `LocationNetSales.trend` (12 monthly dollar points).
  - `metric.momChange` = `(lastFull - priorFull) / priorFull` using the last two trend
    points (0 if fewer than 2 points or prior is 0).
  - `metric.source` = `"bigquery"`.
- Gate (`canFetchLiveData`) and null/absent handling unchanged.
- `fetchLocationMembership` unchanged in shape (single-point trend); window is now TTM
  via the query change. Keep `trend: [{ month: "TTM", value: pct }]` (relabel from
  `"YTD"`).

### 3. UI
- `src/components/listing-detail/FinancialsGrid.tsx`: rename prop `netSalesYtd` →
  `netSalesTtm`; label both the connected and fallback cards
  `Net Sales (Trailing 12 Months, Cash + Credit)`; keep the "As of" date and "Live"
  badge.
- `src/app/listings/[id]/page.tsx`: rename `netSalesYtd` → `netSalesTtm`; read
  `r.totalCents` instead of `r.ytdCents`.
- `src/components/kpi/KpiSection.tsx`: section copy "(year-to-date)" → "(trailing 12 months)".
- No new components. `KpiCardRow` → `KpiTrendModal` → `KpiTrendChart` already render
  `metric.trend`; with 12 points the existing "12-Month Trend" modal is correct.

### 4. Memory + follow-up
- Update `mr-percent-definition.md`: window YTD → **trailing 12 full months** (partial
  current month excluded), source/definition otherwise unchanged.
- Follow-up to Prince (note, not code): request a **month-bucketed MCR query** so the
  MCR card can show a real trendline too (see Known Limitations).

## Error handling
- Missing creds / query error → `runQuery` returns `null` → shapers receive `[]` →
  empty map → `fetchLocation*` returns `null` → cards show "Not connected". Unchanged
  degradation path.
- Location absent from the BigQuery map → `null` (not connected). Unchanged.
- Safety invariant unchanged: live data only when `listingStatus === "active" &&
  dataMappingStatus === "confirmed"` (`canFetchLiveData`).

## Testing
- `src/__tests__/bigquery/queries.test.ts`: replace net-sales map tests with
  `rowsToNetSalesByLocation` — asserts `totalCents` = Σ months (dollars→cents), `trend`
  is sorted dollar points, null location skipped. Keep/adjust `rowsToMcrMap` tests.
- `src/__tests__/kpi/revenue.test.ts`: mock `getNetSalesByLocation` to return the new
  `LocationNetSales` shape; assert `totalCents`, `metric.lastMonth` (dollars),
  `metric.trend` length/values, `metric.momChange` (latest vs prior), `source`, and the
  `null` cases (not active+confirmed / missing name / absent location).
- `src/__tests__/kpi/membership.test.ts`: unchanged behavior; verify TTM label point.
- Tests must not hit live BigQuery (mock `@google-cloud/bigquery` / the queries module);
  `vi.mock("server-only", () => ({}))` where needed.
- Full `npm test` + `npm run build` green before done.

## Known Limitations / Open Notes
- **MCR has no monthly breakdown.** Prince's MCR query returns one aggregate per
  location, so the MCR trend modal shows a single bar. Accepted for now; follow up with
  Prince for a month-bucketed MCR query. Do not fabricate monthly MCR points.
- **MoM arrow vs. annual-total headline (revisit later).** The Revenue KpiCard always
  renders a MoM line, but its headline is now the **TTM total**. We show the latest full
  month vs. prior month as a recent-momentum signal (option (a)), which is slightly
  ambiguous next to an annual total ("↑ +8%" reads as if the total moved 8%). Alternative
  if it confuses stakeholders: suppress to a neutral "→ 0%" / hide the line for the
  TTM-total card (option (b)). Flagged for future revisit per stakeholder request.

## Out of scope (YAGNI)
- Bundle/aggregate listings (still mock).
- New Clients / Bookings tiles (still hidden, no live source).
- Profitability (remains a manual field).
