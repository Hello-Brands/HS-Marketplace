# MCR Card Monthly Trendline — Design

**Date:** 2026-06-22
**Branch:** rock-2
**Status:** Approved (design)

## Problem

The Membership Conversion (MCR) card in the listing-detail "Performance Data" section
shows a single pooled trailing-12-month value, and its click-through trend modal renders
just one `"TTM"` point (a flat dot). Net Sales already has a real 12-point monthly
trendline. This adds the equivalent monthly trendline to MCR.

The blocker was data: the existing MCR query returns one pooled aggregate per location.
A live smoke test (2026-06-22) confirmed a month-bucketed MCR query against the same
source table returns clean per-month data — 256 locations, median 12 months each, only
8 zero-prospect months dataset-wide — so we can author the query ourselves (closes the
"ask Prince for a monthly MCR query" follow-up).

## The ratio constraint (central design fact)

For Net Sales the card total is the **sum** of the monthly values, so headline and trend
derive from the same numbers. **MCR is a ratio** and cannot be summed or averaged across
months to recover the true period figure. The smoke test proved it: for Sugar House the
pooled TTM MCR is **34.5%** while the naïve average of its monthly MCRs is **33.7%**.

Therefore:
- The **card headline stays the pooled TTM MCR** — the existing `getMcrByLocation()`
  query, unchanged. This is the rigorous period figure (Σ new ÷ Σ prospects over 12
  full months) and is what the card shows today.
- A **separate monthly query feeds the trendline only**. The two are independent: the
  headline is the pooled ratio; the trend visualizes month-to-month movement.

Decision (approved): headline = pooled TTM, **not** the most recent month. Rationale:
parallels the Net Sales card (TTM aggregate, not last month), is the rigorous figure,
and changes nothing about the number stakeholders already read.

## Decisions

1. **Headline = pooled TTM MCR** (unchanged `getMcrByLocation()` value).
2. **Trend = per-month MCR**, from a new month-bucketed query, on the same 12-full-month
   window (partial current month excluded in SQL), with friendly `"Mon YYYY"` labels.
3. **Drop zero-prospect months from the trend.** A month with 0 prospects yields a null
   ratio (`SAFE_DIVIDE`). Plotting it as "0%" would be misleading ("no prospects", not
   "nobody converted"), so those months are omitted from the trend. A month with
   prospects > 0 but 0 new members is a legitimate 0% and is kept.
4. **`momChange` becomes real** — latest full month vs. prior full month from the last
   two trend points (replacing the hardcoded `0`), matching the Net Sales treatment.

## Components & data flow

### 1. `src/lib/bigquery/queries.ts`
- Add `MCR_TREND_SQL` — month-bucketed MCR (verified by smoke test):
  ```sql
  SELECT LOCATION_NAME,
    FORMAT_DATE('%Y-%m', DATE_TRUNC(APPOINTMENT_DATE, MONTH)) AS mcr_month,
    ROUND(SAFE_DIVIDE(SUM(NON_LASER_NEW_MEMBERS), SUM(NON_LASER_PROSPECTS)) * 100, 1) AS mcr_pct
  FROM `even-affinity-388602.data_mart_for_tools.vw_mcr_data_agg_raw`
  WHERE APPOINTMENT_DATE >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
    AND APPOINTMENT_DATE <  DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY LOCATION_NAME, mcr_month
  ORDER BY LOCATION_NAME, mcr_month
  ```
- Add pure shaper `rowsToMcrTrendByLocation(rows)` → `Map<string, { month: string; value: number }[]>`:
  - skip rows with null `LOCATION_NAME` or null `mcr_month`;
  - **skip rows with null `mcr_pct`** (zero-prospect months);
  - accumulate `{ rawMonth: mcr_month, value: toNumber(mcr_pct) }` per location;
  - sort each location's points by `rawMonth` ascending, **then** map `month` to the
    display label via the existing `formatMonthLabel()` helper (same two-phase
    sort-then-format pattern as `rowsToNetSalesByLocation`, so chronological order is
    preserved). `value` stays the percentage number (e.g. `42.3`).
- Add `getMcrTrendByLocation(): Promise<Map<string, { month: string; value: number }[]>>`,
  cached via `unstable_cache` (store `Array.from(entries())`, rebuild `Map` in the
  wrapper), key `["bq-mcr-trend-ttm"]`, tags `["bq-mcr-trend"]`, `revalidate: 86400`.
- `getMcrByLocation()` (pooled) and the Net Sales functions are unchanged.

### 2. `src/lib/kpi/fetch.ts`
`fetchLocationMembership` keeps its signature and gate, and:
- still returns `null` when not active+confirmed, `bqLocationName` is null, or the
  location is absent from the pooled map;
- `lastMonth` = pooled MCR `pct` (unchanged — the headline);
- fetches `getMcrTrendByLocation()` and uses that location's points as `trend`;
- `momChange` = `(last - prior) / prior` from the last two trend points; `0` if fewer
  than 2 points or prior is 0 (same helper logic as revenue);
- **fallback:** if the trend map has no points for this location (e.g. all months were
  zero-prospect), use `trend: [{ month: "TTM", value: pct }]` and `momChange: 0` — the
  current behavior — so the card still renders honestly;
- `source: "bigquery"`, `updatedAt` unchanged.

### 3. UI — no changes
`KpiTrendChart` already renders a multi-point series; the conditional modal title (added
in the prior fix wave) shows "— 12-Month Trend" once there are ≥2 points. The MCR modal
goes from a single dot to a real line with no component edits.

## Error handling
- Missing creds / query error → `runQuery` returns `null` → shaper receives `[]` → empty
  map → `fetchLocationMembership` hits the single-point fallback (or returns `null` via
  the unchanged pooled-map gate). Degradation unchanged.
- Safety invariant unchanged: live data only when `listingStatus === "active" &&
  dataMappingStatus === "confirmed"`.

## Testing
- `src/__tests__/bigquery/queries.test.ts`: add a `rowsToMcrTrendByLocation` describe
  block — asserts out-of-order input sorts chronologically with `"Mon YYYY"` labels,
  null `mcr_pct` (zero-prospect) months are dropped, a legitimate `0` value is kept, and
  null `LOCATION_NAME`/`mcr_month` rows are skipped.
- `src/__tests__/kpi/membership.test.ts`: mock BOTH `getMcrByLocation` (pooled) and
  `getMcrTrendByLocation` (trend). Assert: `lastMonth` = pooled pct; `trend` = the
  monthly points (length, labels, values); `momChange` = latest-vs-prior; `source`
  `"bigquery"`; the empty-trend fallback (`[{month:"TTM",...}]`, `momChange 0`); and the
  unchanged null/gate cases.
- Tests must not hit live BigQuery — mock `@/lib/bigquery/queries`. Full `npm test` +
  `npm run build` green before done.

## Out of scope (YAGNI)
- Bundle/aggregate listings (still mock/aggregate).
- Net Sales (already done).
- The pre-existing mock-data `momChange` scale bug (separate ticket).
