# Listing-Detail Financials / Performance Cleanup — Design

**Date:** 2026-06-26
**Status:** Approved (pending spec review)

## Summary

Clean up the listing-detail view (`/listings/[id]`) so the same Net Sales figure isn't shown twice, the surviving card is clearly labelled, and the cards stop showing a misleading single-month delta. Purely a **display-layer** change — no database, listing-form, BigQuery-query, or bundle changes.

## Background

The listing-detail page renders two sections fed by two pipelines:

- **Financials** (`FinancialsGrid.tsx`) — Asking Price and TTM Profit come from the Postgres `listings` row (seller-entered: `asking_price`, `ttm_profit`). A third card, **Net Sales (Trailing 12 Months, Cash + Credit)**, is computed in `page.tsx` from BigQuery (`fetchLocationRevenue` → `getNetSalesByLocation`) and passed in as `netSalesTtm`.
- **Performance Data** (`KpiSection.tsx` → `KpiCardRow.tsx`) — a **Revenue** card and a **Membership Conversion** card. The Revenue card uses the *same* BigQuery source and the *same* value as the Financials Net Sales card. It is clickable (opens `KpiTrendModal` with the monthly chart) and shows a month-over-month arrow.

So **Net Sales (Financials) and Revenue (Performance Data) are duplicates** — identical value, identical source. Additional facts established during design:

- The single-location `KpiSection` also fetches an optional "base" KPI bundle via `fetchLocationKpi` (internal HS API, or **mock data** in dev when `HS_INTERNAL_API_URL`/`_TOKEN` are unset) and merges it via `buildLocationKpi`. New Clients & Bookings are always force-hidden (no live source), so the base contributes nothing to the displayed cards except a *risk* that mock Revenue/MCR could render when BigQuery is disconnected.
- The Net Sales BigQuery query (`NET_SALES_SQL`) only spans the **last 12 months**, so there is no prior-year data to compute a true year-over-year delta. The card's `+18%`-style arrow is a single-month MoM change shown under a 12-month total — a semantic mismatch.
- Live data is gated by `canFetchLiveData`: `listingStatus === 'active' && mappingStatus === 'confirmed'` (plus a `bqLocationName` match).
- `TTM Profit` is **profit**, not net sales; there is no live profit source. It is kept as-is.

## Decisions (from brainstorming)

- **Keep** the Net Sales card that lives in **Performance Data** (it's clickable with a trend modal); **remove** the duplicate in Financials.
- **Keep TTM Profit** (card + the listing-form input) — unchanged.
- **Tight card label** "Net Sales (TTM · Cash + Credit)"; the **trend modal** shows the full phrase "Net Sales (Trailing 12 Months, Cash + Credit)".
- **Remove the per-card MoM arrow** from the single-location Net Sales and Membership Conversion cards. The monthly chart stays in the trend modal.
- When a location isn't connected to live data, show a **"— / Not connected" placeholder** card (don't hide), and never show mock data under the Net Sales label.

## Out of scope (unchanged)

Database schema, the listing creation wizard and edit forms, the BigQuery SQL/queries, the **bundle** KPI path (`fetchBundleKpi`, `BundleKpiSection`, `aggregateBundleKpi`), and the `/api/kpi/[locationId]` route.

## Architecture / changes

### 1. `src/components/listing-detail/FinancialsGrid.tsx`
- Remove the Net Sales card block and the `netSalesTtm` and `hasSalonLocations` props. The component renders only Asking Price (primary), TTM Profit, and the Included Assets block.

### 2. `src/app/listings/[id]/page.tsx`
- Remove the `salonLocations` revenue loop and the `netSalesTtm` computation (they fed only the removed card). Render `<FinancialsGrid listing={listing} />` without the dropped props.
- `KpiSection` continues to receive the same props it does today (it fetches its own revenue/MCR). The `fetchLocationRevenue` import here can be removed if it becomes unused.

### 3. `src/components/kpi/KpiSection.tsx` (single-location branch only)
- Source the two cards **purely from BigQuery**: keep `fetchLocationRevenue` and `fetchLocationMembership`; **remove** the `fetchLocationKpi` (base/mock) call and the `buildLocationKpi` merge for this branch. Build the displayed data directly from the BigQuery results.
- **Always render** the section for non-territory single locations (territory listings still return `null`), so the placeholders can appear when data isn't connected. (Today the section returns `null` when no KPI data exists.)
- Keep the existing subtitle logic: "Net Sales and MCR are live from BigQuery (trailing 12 months)." when Net Sales is live (`source === 'bigquery'`); otherwise "Live data not connected for this location."
- Render the two cards via the new `LocationKpiCards` component (below), passing the Net Sales metric (or null) and the MCR metric (or null).
- The **bundle** branch is unchanged (still uses `fetchBundleKpi` + `aggregateBundleKpi` + `KpiCardRow` + `BundleKpiSection`).

### 4. New `src/components/kpi/LocationKpiCards.tsx` (client)
- Renders exactly two fixed slots in order — **Net Sales**, then **Membership Conversion** — each:
  - **Live** (metric present): an interactive `KpiCard` (clickable → `KpiTrendModal`), with `showDelta={false}`, the tight card label, and the full modal title.
  - **Not connected** (metric null): a static, non-interactive placeholder card showing the label and "— / Not connected" in a muted style — no modal and no badge.
- Owns the trend-modal open/close state (mirrors how `KpiCardRow` does it today) and reuses `KpiCard` + `KpiTrendModal`. The value formatters: Net Sales → `$<comma-grouped, 0 dp>`; MCR → `<one-dp>%`.
- Card label vs modal title: Net Sales card label = "Net Sales (TTM · Cash + Credit)"; modal title = "Net Sales (Trailing 12 Months, Cash + Credit)". MCR card label and modal title = "Membership Conversion".
- `KpiCardRow.tsx` is left in place for the bundle path; the small duplication of modal-wiring between it and `LocationKpiCards` is accepted to keep the bundle path untouched.

### 5. `src/components/kpi/KpiCard.tsx`
- Add `showDelta?: boolean` (default `true`). When `false`, the MoM change line is not rendered. Default preserves existing behaviour everywhere else (bundle cards).

### 6. Cleanup
- Remove `src/lib/kpi/assemble.ts` (`buildLocationKpi`) and its test `src/__tests__/kpi/assemble.test.ts` — confirmed used only by the single-location `KpiSection` branch being changed.
- **Do NOT** remove `fetchLocationKpi` / `mockLocationKpi` — still used by the bundle path (`fetchBundleKpi`) and the `/api/kpi/[locationId]` route.

## Not-connected behaviour (explicit)

For a non-territory single-location listing:
- Net Sales live + MCR live → two interactive cards, subtitle "live from BigQuery…".
- Either metric missing → that card shows the "Not connected" placeholder; the other still renders live if present.
- Both missing → section still renders with two placeholders and the "Live data not connected for this location." subtitle.

Territory listings: section hidden (unchanged). Bundle listings: unchanged.

## Error handling

- BigQuery fetch failures already degrade to `null` (treated as "not connected") inside `fetchLocationRevenue`/`fetchLocationMembership`; the placeholder path covers this.
- Removing the mock base means dev environments without BigQuery credentials show "Not connected" rather than sample numbers — an intentional honesty improvement.

## Testing

- The pure BigQuery row-mappers (`rowsToNetSalesByLocation`, etc.) are unchanged and keep their existing tests.
- `assemble.test.ts` is removed with `buildLocationKpi`.
- Remaining changes are UI; the repo has no React component test harness, so verification is `npx tsc --noEmit`, the existing vitest suite (must stay green), and a manual browser check of: live state (two interactive cards, no card arrow, tight label, full modal title), not-connected state (placeholders), and the trimmed Financials row.
