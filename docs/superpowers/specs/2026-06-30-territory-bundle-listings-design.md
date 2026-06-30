# Territory & Bundle Listings — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorming)

## Problem

Two listing types need their financial/performance presentation corrected:

1. **Territory listings** are rights to unopened locations — not revenue-generating. The
   listing detail still shows a "TTM Profit" card (and the seller form still collects it),
   which is meaningless for a territory.
2. **Bundle listings** should present both an **aggregate** view of the whole bundle and a
   way to **drill into each individual location's** performance. Today the bundle performance
   section runs on mock data from the internal HS API (`fetchBundleKpi`) and shows
   Revenue / New Clients / Bookings / Membership — inconsistent with single-location
   listings, which show **real BigQuery** data (Net Sales + MCR only).

## Decisions

- TTM Profit is removed for **territory listings only** — on **both** the buyer-facing
  detail page and the seller form. Suite, flagship, and **bundle** listings keep TTM Profit.
- Bundle drill-in = a **per-location modal** (a mini single-listing performance view).
- Bundle aggregate + per-location metrics use **real BigQuery** data (Net Sales + MCR),
  matching single-location listings. The mock New Clients / Bookings metrics are dropped.
- Aggregate bundle **MCR** is shown as a **labeled average** ("Avg. across N locations"),
  because true pooled MCR (new members ÷ prospects) is not computable from current
  BigQuery output — `getMcrByLocation()` returns only the per-location ratio, not the
  underlying counts. Aggregate **Net Sales** is a true SUM.

## Part 1 — Territory financials

### `src/components/listing-detail/FinancialsGrid.tsx`
- When `listing.type === 'territory'`: render only the **Asking Price** card, full-width,
  keeping the primary (caramel) styling. Do **not** render the TTM Profit card.
- All other types: unchanged (Asking Price + TTM Profit, two-up grid).
- "Included Assets" block is unchanged for all types.

### `src/components/listings/steps/FinancialsStep.tsx`
- When the listing `type === 'territory'`:
  - Hide the **TTM Profit** input.
  - Hide the "Verified data (pulled from Hello Sugar) → TTM Revenue" block (territories
    have no revenue; it would read $0 and mislead). The per-location MCR rows in that block
    are also irrelevant for territories, so the whole verified-data block is hidden for
    territory listings.
  - Asking Price, square footage, reason-for-selling, and nav buttons stay.
- Read the type via `watch('type')` from the existing `useFormContext<ListingFormData>()`.

## Part 2 — Bundle performance (aggregate + drill-in)

### Data layer — `src/lib/kpi/fetch.ts`
New server function:

```ts
fetchBundleLocationKpis(
  locations: { id: string; name: string; bqLocationName: string | null;
               dataMappingStatus: string }[],
  listingStatus: string,
): Promise<{ id: string; name: string;
             netSales: KpiMetric | null; membership: KpiMetric | null }[]>
```

- Loads the cached BigQuery maps **once**: `getNetSalesByLocation()`, `getMcrByLocation()`,
  `getMcrTrendByLocation()`.
- For each location, gate with `canFetchLiveData(listingStatus, dataMappingStatus)` and look
  up by `bqLocationName`. Build the `netSales` / `membership` `KpiMetric`s the same way the
  single-location `fetchLocationRevenue` / `fetchLocationMembership` do (so the trend modals
  render identically). No N+1 — all lookups hit the already-loaded maps.
- A location with no `bqLocationName` / not connected / not in the map → `netSales: null`,
  `membership: null` (still listed; shows "—/Not connected").

### Aggregation (inline in the bundle branch of `KpiSection`)
- **Net Sales aggregate** = SUM of per-location `netSales.lastMonth`; trend summed by month.
  Reuses the same `KpiMetric` shape so it renders through `LocationKpiCards`.
- **MCR aggregate** = average of present per-location `membership.lastMonth` values; trend
  averaged by month. Card label clarifies it is an average across N locations.
- If no location has live data, the section renders the same "not connected" placeholders as
  single-location (do not hide the whole section silently).

### `src/components/kpi/KpiSection.tsx` — bundle branch rewrite
- Replace the `fetchBundleKpi` / `aggregateBundleKpi` path with `fetchBundleLocationKpis` +
  the aggregation above.
- Header: `Performance Data (N locations)` + the "Verified by Hello Sugar" badge when any
  location is live.
- Render aggregate **Net Sales + MCR** via the existing `LocationKpiCards` (aggregate MCR
  passed with the "Avg. across N locations" label).
- Render the new per-location component (below).
- Keep passing territories through to the "Unopened Territories" list.

### Per-location drill-in — `src/components/kpi/BundleKpiSection.tsx` (rewrite) + new modal
- Compact, sortable table: **Location · Net Sales · MCR** (one row per open salon).
  Net Sales shows TTM total; MCR shows the per-location ratio; missing → "—".
- Clicking a row opens a **per-location modal**: a mini single-listing performance view that
  reuses `LocationKpiCards` to show that location's Net Sales + MCR cards (each with its own
  trend modal). Title = location name.
- Territories remain in the existing "Unopened Territories" list (no KPIs).

### Removed / retired
- `fetchBundleKpi` and `aggregateBundleKpi` (mock 4-metric path) — removed once the bundle
  branch no longer references them.
- `BundleOverlayChart` and the "View all locations" overlay — superseded by the per-location
  modal. Removed.
- `BundleKpiTable`'s New Clients / Bookings columns — gone (table reduced to Net Sales + MCR).
  The table is effectively rewritten as part of `BundleKpiSection`.

## Out of scope
- Aggregated or per-location **reviews** for bundles (single-location keeps its reviews panel;
  bundles do not add one in this pass).
- Changing the underlying BigQuery queries to expose MCR member/prospect counts (would enable
  a true pooled MCR; deferred).

## Testing
- Unit: bundle aggregation (Net Sales sum, MCR average, trend merge) over a fixture of
  per-location `KpiMetric`s, including locations with `null` metrics.
- Unit: `fetchBundleLocationKpis` gating — not-connected / missing `bqLocationName` → null
  metric; connected → populated from the maps.
- Component/render: `FinancialsGrid` for `type === 'territory'` shows Asking Price only, no
  TTM Profit; non-territory unchanged.
- Manual: bundle detail page shows aggregate cards + per-location table; clicking a row opens
  the modal with that location's trends.
