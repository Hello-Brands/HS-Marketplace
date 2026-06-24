# Saved Searches — Design Spec

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Branch:** `dev`

## Summary

Today's "Save this search" button on `/browse` creates an email *alert* that
matches new listings on **state only**. This project expands a saved search to
capture the **full browse filter set** (including the location/radius filter),
makes each saved search **re-applyable** (click → reopen `/browse` with the
filters set), keeps the **email notification** behavior (matching on the
expanded criteria), wires up **navigation** between `/browse` and
`/account/alerts`, and **restyles** `/account/alerts` to match the browse page.

Decided behavior (confirmed with user):
- A saved search both **notifies** (email when a matching listing is approved)
  **and** can be **re-applied** (Apply → `/browse?…`).
- Saving is **one click** with an **auto-generated label**; users can **rename**
  later on the alerts page.
- Email matching uses **state, type, price, min-years, and radius**. The
  free-text `query` and `sort` are **saved for re-apply but not matched**.
- Per-search **notifications on/off** toggle.
- **No in-place filter editor**: to change a saved search's filters, Apply it,
  adjust on `/browse`, and save again. In-place edit = rename / toggle notify /
  delete only.

## Current state (as built)

- **Schema** `src/db/schema/alerts.ts`: `id`, `userId`, `states` (json
  `string[]`), `listingTypes` (json `string[]`), `minPrice` (int, cents),
  `maxPrice` (int, cents), `createdAt`, `updatedAt`. The `listingTypes` /
  `minPrice` / `maxPrice` columns exist but are **unused**.
- **Actions** `src/lib/alert-actions.ts`: `createAlert` / `updateAlert` write
  **states only** (per a prior CONTEXT.md "states only" decision, now
  superseded). `triggerAlertMatching` matches state only and emails via Resend
  (`sendAlertMatchEmail`). Called from the admin approval action
  `src/lib/admin/actions.ts:110`.
- **UI**: `/account/alerts` (`page.tsx` + `AlertsManager.tsx`) is a centered
  `max-w-2xl` form with `AlertForm` (states-only checkboxes) and `AlertList`.
  No page header / no `UserNav`, so there is no navigation back to `/browse`.
- **Browse** `SaveSearchButton` receives `states` only.
- **Filter source of truth**: `useListingFilters()` in
  `src/components/browse/FilterBar.tsx` — `query`, `types[]`, `states[]`,
  `minPrice`, `maxPrice`, `sort`, `minYearsOpen`, `centerLat`, `centerLng`,
  `radiusMiles`, `centerLabel`. Prices are **cents**.
- **Bug**: the alert email's "Manage your alerts" link points to `/alerts`
  (`src/lib/email.ts:190`); the real route is `/account/alerts`.

## Data model

Extend the `alerts` table with nullable columns (push-managed DB →
`drizzle-kit push`; no data migration needed):

| Column | Type | Notes |
|---|---|---|
| `name` | `text` | User-set label; null = use auto-label |
| `query` | `text` | Free-text filter; saved for re-apply, **not matched** |
| `minYearsOpen` | `integer` | Min years a location has been open |
| `centerLat` | `double precision` | Saved location center |
| `centerLng` | `double precision` | |
| `radiusMiles` | `integer` | |
| `centerLabel` | `text` | Human label for the saved location |
| `sort` | `text` | Saved for re-apply, **not matched** |
| `notifyEnabled` | `boolean` default `true` not null | Per-search email toggle |

Existing columns reused: `states` (json `string[]`), `listingTypes`
(json `string[]`), `minPrice`/`maxPrice` (cents).

## Components & data flow

### 1. Server actions (`src/lib/alert-actions.ts`)

- Widen the Zod schema to accept all fields above (all optional).
- `createAlert` / `updateAlert` persist all fields.
- `triggerAlertMatching(listingId)` — change to fetch the listing + **all its
  locations** by id (currently receives only primary city/state/price). For
  each alert with `notifyEnabled = true`, match by AND across the criteria that
  are set:
  - **state**: `listing.state ∈ alert.states` (empty/null = any).
  - **type**: `listing.type ∈ alert.listingTypes` (empty/null = any).
  - **price**: `askingPrice ≥ minPrice` and/or `≤ maxPrice` when set (cents).
  - **min years**: at least one location's `openingDate` is ≥ `minYearsOpen`
    years ago.
  - **radius**: when `centerLat`/`centerLng`/`radiusMiles` set, at least one
    location is within radius — `isWithinRadius()` from `lib/geo.ts`, using
    `latitude`/`longitude` or `territoryLat`/`territoryLng`.
  - `query` and `sort` are ignored for matching.
  - Email send unchanged (`sendAlertMatchEmail` via Resend).

### 2. Auto-label helper

Pure function `describeSavedSearch(fields) → string`, e.g.
`"Suites · ≤$1M · within 25 mi of Provo, UT"`. Shared by `SaveSearchButton`
(optional, for the toast) and the alerts cards. Components: types, states
(count or names), price range (`$Xk`/`$X.XM`), min years, radius+centerLabel,
query. Empty → `"All listings"`.

### 3. Re-apply helper

Pure function `savedSearchToBrowseParams(alert) → string` producing a
`/browse?…` query string from the saved fields (mirrors `useListingFilters`
param names). Used by the **Apply** link.

### 4. Browse `SaveSearchButton`

- Receives the **full filter object** from `BrowsePage` (not just `states`).
- One-click `createAlert(fullFilters)`; success toast "Saved!" with a link to
  **My Alerts** (`/account/alerts`).
- `BrowsePage` passes all `rawFilters` to the button.

### 5. `/account/alerts` redesign

- Add the **browse-style page header** (HS logo, title, `UserNav`) — extract a
  small shared `BrowseHeader`/`AppHeader` from `BrowsePage`'s header markup and
  reuse it on both pages, so navigation works both ways. Add a prominent
  **"Browse listings"** link/button.
- Render saved searches as **cards in the browse aesthetic** (rounded, bordered,
  branded). Each card shows the name or auto-label, filter chips (type, states,
  price, "within X mi of Y"), and actions: **Apply** (→ `/browse?…`),
  **Rename**, **Delete**, **notifications on/off** toggle.
- Replace the states-only `AlertForm`/`AlertList` with the new card UI. Rename is
  a small inline input; toggle/delete call `updateAlert`/`deleteAlert`.

### 6. Navigation

- The shared header's `UserNav` already links `/browse ↔ /account/alerts`.
- Explicit "Browse listings" affordance on the alerts page; success toast on
  browse links to the alerts page.

### 7. Email link fix

- `src/lib/email.ts`: `/alerts` → `/account/alerts`.

## Error handling

- Server actions keep the existing `{ error }` / `{ success }` shape and auth
  guard; ownership checks on update/delete remain.
- Matching never throws on a single bad alert/listing (filter defensively);
  email failures stay wrapped in try/catch and never block listing approval.
- Re-apply builds only from present fields; absent filters are omitted from the
  URL.

## Testing

- Extend `src/__tests__/alert-actions.test.ts`:
  - `create`/`update` persist all new fields.
  - `triggerAlertMatching`: type-only, price-range, min-years, **radius**
    (in/out of range), combined AND, `notifyEnabled = false` suppresses,
    `query`/`sort` do not affect matching.
- Unit tests for `describeSavedSearch` and `savedSearchToBrowseParams`.

## Out of scope (YAGNI)

- In-place filter editing on the alerts page (use Apply → adjust → re-save).
- Matching on free-text `query`.
- Per-card map previews of the saved radius.
- Changes to the mobile filter drawer.

## Risks / notes

- `triggerAlertMatching` now needs the listing's coordinates; fetch locations by
  `listingId` inside the matcher (the admin call site passes the id).
- Prices are **cents** end-to-end; the browse Price control already converts
  dollars↔cents, and saved values stay in cents.
- DB is push-managed (per project memory); new columns are nullable / defaulted,
  so `drizzle-kit push` is safe and needs no backfill.
