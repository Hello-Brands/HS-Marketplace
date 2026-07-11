# Owner Map Highlight — Design

**Date:** 2026-07-11
**Status:** Approved pending spec review
**Branch:** `feat/owner-map-highlight` (PR to `origin/main`; no merge without explicit approval)

## Summary

On the browse map, render the locations the signed-in owner owns in a distinct
brand-green color. Clicking one of their green dots opens a detail page for
that location showing the same financials the marketplace listing pages show
(live Net Sales trend, MCR, reviews). Nothing changes for users who own no
locations, and nothing changes about what other users see.

## Background

- Owners are auto-linked to their locations at login by email match
  (`src/lib/owner-directory/login.ts`), which sets `users.ownerIdentifier`;
  the session exposes `session.user.ownerIdentifier` (`src/auth.ts:44-52`).
- The map (`src/components/browse/MapView.tsx`, MapTiler SDK) renders three
  layers: crimson for-sale listing dots, taupe unlisted HS-location dots, and
  competitor diamonds. The unlisted-dot data pipeline
  (`src/lib/hs-locations-query.ts`) is a shared 5-minute `unstable_cache`
  that deliberately strips owner identity/PII (DEBT-024 projection).
- Live BigQuery financials are currently served only for active + confirmed
  listings via `canFetchLiveData` (`src/lib/kpi/access.ts`). There is no
  code path serving financials for an owner's own unlisted location.

## Decisions (from brainstorming)

1. Clicking a green dot **navigates to a detail page** (not a popup/panel).
2. The detail page shows the **same financials as marketplace listings**
   (Net Sales TTM + monthly trend, MCR, reviews), reusing existing KPI
   components.
3. **Both dot kinds highlight**: owned unlisted HS locations *and* the
   owner's own for-sale listings. Owned listed dots keep navigating to the
   existing `/listings/[id]` page.
4. Highlight color is **brand success green `#3F7D5B`** (`--color-success`).
5. **Dot size is unchanged** — color is the only visual differentiator.

## Architecture

Approach: **server-computed ownership flag passed as props.** The shared map
caches stay owner-agnostic; ownership matching happens per-request in the
server component using the session.

### 1. Ownership matching (server)

In `src/app/browse/page.tsx`:

- Call the existing owner-scoped query `getMyOwnerLocations()`
  (`src/lib/owner-directory/data.ts:15-40`). Users without an
  `ownerIdentifier` get an empty result and the feature is inert.
- Build one prop, e.g. `myOwnership`, containing two small sets:
  - `ownedLocationIds`: `owner_locations.id` values → matches unlisted HS
    dots by `UnlistedHsLocation.id`.
  - `ownedBqNames`: non-null `resolvedBqLocationName` values → matches
    listing dots by their locations' confirmed BQ names.
- A listing dot is "mine" if `listing.sellerId === session.user.id` **or**
  any of its locations' BQ names is in `ownedBqNames`.
- Matching logic lives in a small pure helper module (e.g.
  `src/lib/owner-map/ownership.ts`) so it is unit-testable.

### 2. Map highlighting (client)

- `src/lib/brand-colors.ts` gains `success: '#3F7D5B'` (matching
  `--color-success` in `globals.css`, per that file's sync convention).
- `MapView.tsx`: dots whose id/BQ-name match render `BRAND.success` instead
  of taupe/crimson. Same size, same shape. Hover recolor uses a darker green
  (`--color-green-700` `#33654A`) consistent with the crimson→crimsonStrong
  hover pattern.
- `MapLegend.tsx`: new "Your locations" row with a green swatch and its own
  toggle (URL-state boolean, consistent with existing rows). The row renders
  only when the user owns at least one mapped location. Because owned dots
  belong to the existing listings/HS layers, toggling this row off does not
  hide the dots — it reverts them to their normal layer color and default
  click behavior. The listings/HS layer toggles still control visibility.

### 3. Click behavior

- Owned **listing** dots: unchanged navigation to `/listings/[id]`.
- Owned **unlisted** dots: clicking navigates to
  `/account/locations/[id]` (today unlisted dots only pin a popup; that
  popup behavior is preserved for dots the user does not own).
- All non-owned dots behave exactly as today.

### 4. Owner location detail page

New route: `src/app/account/locations/[id]/page.tsx`.

- Server component. Loads the `owner_locations` row by id and **verifies
  `row.ownerIdentifier === session.user.ownerIdentifier`**; any mismatch or
  missing row → `notFound()`. Admins get no special access in this feature.
- Shows location details: name, address, city/state, opened date,
  connection status.
- Shows financials keyed by `resolvedBqLocationName`, reusing the existing
  KPI components used on `src/app/listings/[id]/page.tsx`
  (`LocationKpiCards`, reviews panel) via `src/lib/kpi/fetch.ts`.
- If `resolvedBqLocationName` is null: render a "not connected to
  financials" state instead of numbers (mirrors the badge on
  `/account/locations`).
- The existing "My Locations" list page (`/account/locations`) links each
  card to its detail page, so the map is not the only entry point.

### 5. New financials access rule

- Add an owner-scoped rule alongside the existing listing gate: an owner may
  fetch live KPIs for a location when the `owner_locations` row's
  `ownerIdentifier` equals their session's `ownerIdentifier` and the row has
  a `resolvedBqLocationName`.
- Enforced server-side (page/fetch layer). The BQ location name is read from
  the verified DB row — never from client input.
- `canFetchLiveData` and every existing listing-based path are unchanged.

### 6. Edge cases

- Owned location without geocode → no dot (unchanged); still reachable from
  the list page.
- Owned location with no `resolvedBqLocationName` → detail page renders the
  not-connected state.
- Closed locations → follow existing dot filtering (`isLocationOpen`); no
  special handling.
- Multi-location (bundle) listings → the listing dot is "mine" if any of its
  locations match; clicking still goes to the listing page, which already
  handles bundles.
- "Your locations" legend toggle off + owned dot: dot renders and behaves
  exactly as a non-owned dot of its layer.

## Out of scope

- Admin "view as owner" or admin highlighting of arbitrary owners' locations.
- Any change to the shared HS-locations cache shape or its PII projection.
- New financial metrics beyond what listings already show.
- Owner-facing editing of location data.

## Testing

- Unit tests for the ownership-matching helper: id match, BQ-name match,
  sellerId match, bundle listings, empty/no-owner case.
- Unit test for the owner-scoped access rule (owns / doesn't own / no
  resolved BQ name).
- Route-level test: non-owner requesting `/account/locations/[id]` for
  someone else's location gets 404.
- Existing map/filter/listing tests stay green.
- Verification gate per repo conventions: `tsc` per step; stop dev server
  before any `next build` (Windows lock).

## Delivery

- Feature branch `feat/owner-map-highlight`, PR against `origin/main`.
- **Do not merge to main** — user reviews and merges the PR themselves.
