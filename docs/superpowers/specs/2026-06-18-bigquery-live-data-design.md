# BigQuery Live Data Integration — Design

**Date:** 2026-06-18
**Branch:** rock-2
**Status:** Approved (design); pending spec review

## Summary

Replace the non-functional Boulevard integration with **BigQuery** as the source
of real per-location financial/KPI data for marketplace listings. The data
already exists in BigQuery (project `even-affinity-388602`), exposed through two
pre-aggregated views the data team maintains. We keep the existing
location-mapping + admin-approval-gate architecture and swap only the data source
underneath it.

### Why

- The Boulevard Admin API client (`src/lib/boulevard/`) never authenticated. Live
  test against the sandbox returned `HTTP 302 — Unauthorized`; the auth scheme in
  the code (`Basic base64(key:)`) does not match Boulevard's signed-token scheme,
  and the GraphQL queries were never verified. It was explicitly marked as an
  unfinished "live-iteration point."
- The data team (Prince) confirmed the same metrics already exist in BigQuery and
  provided a dev service account + the exact queries. Prince's Net Sales figure
  **ties out to the company's official Month-over-Month dashboard**, making it the
  source of truth.

## Decisions (locked with stakeholder)

1. **Replace** Boulevard entirely — do not run both. Remove the dead client + env.
2. **Revenue metric:** show **YTD Net Sales (Cash + Credit)** exactly as Prince's
   query computes it; relabel the card from "TTM Revenue" to
   **"Net Sales (YTD, Cash + Credit)"**. (TTM was never real; YTD ties to the
   official dashboard.)
3. **MCR definition:** adopt Prince's — **new members ÷ prospects, laser visits
   excluded**, YTD. (Supersedes the earlier `÷ unique ordering clients` definition.)
4. **Detail level:** single YTD figures for v1; no sparkline / month-over-month
   for BigQuery-backed metrics. Ask Prince for month-bucketed queries in a future
   iteration to restore trends.
5. **New Clients & Bookings:** Prince provided no source for these. **Hide them**
   from the KPI section for v1 (do not show mock numbers next to real ones). Add to
   the Prince follow-up list.

## Data source

- **Project:** `even-affinity-388602`
- **Dev auth:** generic shared service account
  `parker-fellows@even-affinity-388602.iam.gserviceaccount.com` (JSON key, dev only).
- **Net Sales (YTD, Cash + Credit), by location:**
  ```sql
  SELECT LOCATION_NAME, ROUND(SUM(TRANSACTION_AMOUNT), 2) AS cash_plus_credit
  FROM `even-affinity-388602.snowflake_data.vw_order_payments_raw`
  WHERE CREATED_ON >= DATE_TRUNC(CURRENT_DATE(), YEAR)
  GROUP BY LOCATION_NAME
  ORDER BY cash_plus_credit DESC;
  ```
- **MCR (YTD), by location:**
  ```sql
  SELECT LOCATION_NAME,
    SUM(NON_LASER_NEW_MEMBERS) AS new_members,
    SUM(NON_LASER_PROSPECTS) AS prospects,
    ROUND(SAFE_DIVIDE(SUM(NON_LASER_NEW_MEMBERS), SUM(NON_LASER_PROSPECTS)) * 100, 1) AS mcr_pct
  FROM `even-affinity-388602.data_mart_for_tools.vw_mcr_data_agg_raw`
  WHERE APPOINTMENT_DATE >= DATE_TRUNC(CURRENT_DATE(), YEAR)
  GROUP BY LOCATION_NAME
  ORDER BY mcr_pct DESC;
  ```

Both views are pre-aggregated (≈ one row per location), so a single query returns
the full location set cheaply.

## Architecture

Keep the existing units; swap the source. The KPI components, badge logic, and the
active+confirmed safety invariant are unchanged in behavior.

### New units

- **`src/lib/bigquery/client.ts`** (`server-only`)
  - Lazy singleton `BigQuery` client.
  - Credentials: prefer `BIGQUERY_CREDENTIALS` (full JSON as a single-line string,
    for Vercel); fall back to `GOOGLE_APPLICATION_CREDENTIALS` (file path, local).
  - `projectId` from `BIGQUERY_PROJECT_ID`.
  - Returns `null`/throws-caught on missing creds so callers degrade to
    "not connected", mirroring the current Boulevard fallback contract.

- **`src/lib/bigquery/queries.ts`**
  - `getNetSalesByLocation(): Promise<Map<string, number>>` — LOCATION_NAME → cents.
  - `getMcrByLocation(): Promise<Map<string, number>>` — LOCATION_NAME → mcr_pct.
  - `listLocationNames(): Promise<string[]>` — distinct LOCATION_NAME for the admin
    mapping dropdown.
  - Each wrapped in `unstable_cache` with `revalidate: 86400` (daily) and a tag for
    manual invalidation, following the existing pattern in `src/lib/kpi/fetch.ts`.
  - **Unit conversion:** BigQuery returns dollars → store/compare in cents via
    `Math.round(dollars * 100)`. MCR stays as a percentage number.

### Changed units

- **`src/lib/kpi/fetch.ts`** — `fetchLocationRevenue` / `fetchLocationMembership`
  keep their signatures but key off the mapped `LOCATION_NAME` and read from the
  cached BigQuery maps instead of Boulevard. Return a single YTD figure with a
  single-point `trend` (one entry, current YTD) so the existing `KpiMetric` shape
  stays valid, `momChange: null`, and `source: "bigquery"`. The UI hides the
  sparkline/MoM when `trend.length < 2`.
- **`src/lib/kpi/access.ts`** — rename `canFetchBoulevard` → `canFetchLiveData`
  (same rule: `listingStatus === "active" && mappingStatus === "confirmed"`).
- **`src/db/schema/listings.ts`** (`listing_locations`):
  - `boulevard_location_id` → `bq_location_name` (text, the matched LOCATION_NAME)
  - `boulevard_mapping_status` → `data_mapping_status`
    (enum unchanged: `unconfirmed | confirmed | not_connected`)
  - Applied via drizzle push (DB is push-managed per project convention).
- **`/admin/boulevard` screen** — repurpose to a generic data-mapping screen: list
  app locations, suggest a `LOCATION_NAME` by fuzzy match against
  `listLocationNames()`, admin confirms → `data_mapping_status = "confirmed"`.
- **Financials card** (`FinancialsGrid.tsx`) — relabel to
  "Net Sales (YTD, Cash + Credit)"; "Boulevard" badge → "BigQuery" / "live".
  "Not connected" fallback unchanged.
- **KPI section** — Membership Conversion shows real YTD MCR (no sparkline);
  New Clients and Bookings hidden for v1.

### Removed units

- `src/lib/boulevard/` (client + types).
- `BOULEVARD_*` entries in `.env.example`.

## Data flow

1. Listing detail page loads a listing + its `listing_locations`.
2. For each salon location with `data_mapping_status === "confirmed"` and listing
   `status === "active"` (`canFetchLiveData`), look up its `bq_location_name` in the
   cached Net Sales / MCR maps.
3. Found → render real value + as-of date + "live" badge. Missing map entry,
   unmapped, unconfirmed, or no creds → render "—" / "not connected".

## Environment

```
BIGQUERY_PROJECT_ID=even-affinity-388602
# Local dev: path to the downloaded key file (gitignored)
GOOGLE_APPLICATION_CREDENTIALS=./.secrets/bq-key.json
# Vercel / prod: full JSON as a single-line string
BIGQUERY_CREDENTIALS={"type":"service_account",...}
```

Add `@google-cloud/bigquery` dependency.

## Security

- The dev key was shared via a **public** Google Drive link and is a **shared
  generic** service account. Treat as low-trust: gitignore the key file, never use
  it in a deployed (preview/prod) environment.
- Request a **dedicated production service account** from Prince. Proposed app
  name: **`hs-marketplace`**.
- All BigQuery access is `server-only`; credentials never reach the client bundle.

## Error handling

- Missing creds, query failure, timeout, or unmapped location → return `null` →
  UI shows "not connected" (no crash, matches current contract).
- Validate query result shape (zod or a light runtime guard) before use.

## Testing

- Unit-test dollars→cents conversion and map lookup/fallback with a mocked client
  (no live BigQuery in tests).
- Update/replace existing Boulevard-referencing tests.
- Manual verification: a live query against the dev account returning a known
  location, plus an end-to-end check that a confirmed-mapped active listing shows a
  real Net Sales figure.

## Follow-ups for Prince

1. App name for the dedicated **prod** service account: **`hs-marketplace`**.
2. Month-bucketed Net Sales and MCR queries (to restore trend sparklines + MoM).
3. New Clients and Bookings by location, if those KPI tiles should become real.

## Out of scope (v1)

- Trend sparklines / month-over-month for BigQuery metrics.
- Real New Clients and Bookings metrics.
- Automated (non-human-confirmed) location mapping.
