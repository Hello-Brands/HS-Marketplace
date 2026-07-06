# Unlisted Hello Sugar Locations — Map Layer

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan

## Summary

Like Zillow shows homes that exist but aren't for sale, the marketplace `/browse`
map will show **open Hello Sugar locations that are not currently listed for
sale** as a distinct dot layer. These dots appear **only on the map** (never in
the listing-card list). Hovering a dot shows a small non-PII info card; there is
**no** click-through to a detail page.

A collapsible **map key** is added to the map, documenting all four marker types.

## Goals

- Surface the existence of open HS locations that aren't on the market, as map
  dots visually distinct from for-sale listings.
- Hover reveals relevant, non-sensitive info for that location.
- Add an on-map, collapsible key (legend + layer toggles).

## Non-Goals (YAGNI)

- No detail page or click navigation for the unlisted dots.
- No owner PII (name/email) in the hover card.
- No KPIs/financials in the hover card.
- No competitor opportunity-vs-closed sub-filtering (they keep sharing one toggle).
- No admin UI for directory geocoding.
- Closed/exited HS locations are **not** shown.

## Context (current state)

- `/browse` (`src/app/browse/page.tsx`) requires auth and server-fetches
  listings + competitor closures in a `Promise.all`, passing them to
  `BrowsePage` → `MapView`.
- `MapView` (`src/components/browse/MapView.tsx`) already renders **two**
  DOM-marker layers via MapTiler:
  - **Listings** — pink (`#db2777`) filled 16px circles, clickable → detail page,
    hover popup; toggled by `showListings`.
  - **Competitor closures** — two diamond styles: *opportunity* (caramel
    `#B9772E` filled diamond) and *closed/muted* (taupe `#8F7067` hollow
    diamond); hover popup, no navigation; toggled by `showCompetitors`.
- Layer visibility lives in nuqs URL state (`FilterBar.useListingFilters`):
  `showListings`, `showCompetitors` (both default true). Today the toggles render
  as chips in the top bar via `LayerToggles`.
- `owner_locations` (`src/db/schema/ownerLocations.ts`) is the HS owner directory,
  full-refresh synced from BigQuery. It has `locationAddress` (text),
  `blvdLocationName`, `blvdLocationNumber`, owner name/email, suite/flagship
  actual-go and closed dates, and `resolvedBqLocationName` (the matched BigQuery
  `LOCATION_NAME`, preserved across syncs). **It has no lat/lng.**
- `listing_locations` (`src/db/schema/listings.ts`) carries geocoded
  `latitude`/`longitude` and `bqLocationName` (same key space as
  `owner_locations.resolvedBqLocationName`).
- `geocodeAddress(address)` (`src/lib/geocode/geocode.ts`) is a reusable,
  best-effort forward geocoder (returns null below a relevance threshold or on
  any failure; never throws).

## Design decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Which locations | **Open, not listed** — open HS locations minus those already listed for sale. Excludes closed. |
| Hover data | **Non-PII only** — location name, city/state, "Open since {year}". |
| Map key | **Legend + toggles**, on-map, collapsible; retire the top-bar chips. |
| Key contents | **4 swatches, 3 toggles** — two dot colors (for-sale, not-listed) as independent toggles; two competitor diamonds share the one competitors toggle. |
| New dot style | **Solid slate `#64748b` filled circle** (same 16px shape as listings, distinct color). |
| Coordinates | **Geocode `owner_locations` once and store** (schema columns + backfill + geocode-on-sync). |

## Architecture

### 1. Data & geocoding

- **Migration** — add to `owner_locations`:
  - `latitude` (`doublePrecision`, nullable)
  - `longitude` (`doublePrecision`, nullable)
  - `geocodedAt` (`timestamp`, nullable)
  - index on `(latitude, longitude)` to back the bounding-box prefilter.
- **Backfill script** `scripts/geocode-owner-locations.ts`, mirroring the
  existing `scripts/geocode-locations.ts` — for every row without coords, call
  `geocodeAddress(locationAddress)` and persist the result + `geocodedAt`. Rows
  that fail (missing/low-relevance address) stay null and never appear on the
  map. Log a processed/succeeded/failed count.
- **Sync change** (`src/lib/owner-directory/sync.ts`) — the directory is
  full-refresh, but `resolvedBqLocationName` is already preserved across syncs;
  extend that preservation to `latitude`/`longitude`/`geocodedAt`. After the
  upsert, geocode rows that still lack coords (new locations, or rows whose
  `locationAddress` changed). Best-effort, never blocks the sync.

### 2. Query + "open, not listed" rule

New read-only module `src/lib/hs-locations-query.ts` (mirrors the shape and
resilience of `src/lib/competitor-query.ts`):

```ts
export interface UnlistedHsLocation {
  id: string
  name: string          // blvdLocationName
  city: string | null
  state: string | null
  latitude: number
  longitude: number
  openedSince: number | null  // year of the earliest actual go-date (suite or flagship)
}

export async function getUnlistedHsLocations(
  scope?: CompetitorScope   // reuse the existing scope shape (center/radius/states)
): Promise<UnlistedHsLocation[]>
```

Filter rules:
- **Geocoded** — `latitude`/`longitude` not null.
- **Open** — has an actual go-date (`actualSuiteGoDate` or `actualFlagshipGoDate`)
  in the past **and** the corresponding closed-date is null or in the future.
  A location open on either the suite or flagship track counts as open.
- **Not listed** — its `resolvedBqLocationName` does not equal the
  `bqLocationName` of any `listing_location` belonging to a listing with
  `status = 'active'`. Rows with a null `resolvedBqLocationName` cannot match and
  are therefore shown.
- **Dedupe** — one dot per physical location (key on `blvdLocationNumber` when
  present, else normalized `blvdLocationName` + address). Ownership-transfer
  duplicates collapse to a single dot.
- **Scope** — when a full center+radius is provided, prefilter with a bounding
  box (uses the new index), then apply the precise scope filter in JS, mirroring
  `getCompetitorClosures`.
- **Resilient** — wrapped in try/catch; returns `[]` on any failure so it never
  blocks the page. Parses city/state from `locationAddress` if discrete columns
  are unavailable.

City/state: `owner_locations` stores a single `locationAddress` string. Parse
city/state from it with the existing `parseUsAddressTail()` in
`src/lib/geocode/address.ts`; if not parseable, `city`/`state` are null and the
popup falls back to the address string.

### 3. Map layer + hover (`MapView.tsx`)

- New props: `hsLocations?: UnlistedHsLocation[]`, `showHsLocations?: boolean`
  (default true).
- New marker effect, structured like the listings effect but:
  - **Slate `#64748b`** filled 16px circle, white border, same shadow.
  - Hover (`mouseenter`/`mouseleave`) shows/hides a brand-styled popup; **no**
    click handler, **no** `onHover`/list coordination (these rows aren't in the
    list).
  - Rebuilds when `hsLocations` or `showHsLocations` changes; cleared when
    `showHsLocations` is false. Independent of listing `fitBounds` (listings
    still own viewport framing).
- Popup HTML (escaped via the existing `escapeHtml`): location name (bold),
  city/state (or address fallback), and "Open since {year}" when available.

### 4. Collapsible map key (`MapLegend`)

- New component `src/components/browse/MapLegend.tsx`, absolutely positioned
  bottom-left inside the map panel (same overlay pattern as `RadiusSearchHint`).
- Collapses to a "Map key ▾" header; expands to show:
  - **For sale** — pink circle — toggles `showListings`.
  - **Hello Sugar (not listed)** — slate circle — toggles `showHsLocations`.
  - Grouped under one **Competitors** toggle (`showCompetitors`):
    - **Opportunity** — caramel diamond.
    - **Closed** — taupe hollow diamond.
- Reads/writes nuqs state via `useListingFilters`.
- Add `showHsLocations: parseAsBoolean.withDefault(true)` to `useListingFilters`.
- Remove the top-bar `LayerToggles` usage from `BrowsePage`; delete/retire
  `LayerToggles`/`LayerChip` (their swatch styling moves into `MapLegend`).

### 5. Wiring (`browse/page.tsx` + `BrowsePage.tsx`)

- Add `getUnlistedHsLocations({ centerLat, centerLng, radiusMiles, states })` to
  the page's `Promise.all` and pass results down to `BrowsePage` →
  `MapView` **only**. Do **not** pass to `BrowseListContent`.
- `BrowsePage` forwards `hsLocations` + `showHsLocations` and renders `MapLegend`
  in the map panel.

## Data flow

```
BigQuery vw_monday_data_raw
  -> owner-directory sync (upsert + preserve coords + geocode missing)
       -> owner_locations (now with lat/lng)
browse/page.tsx (server)
  -> getUnlistedHsLocations(scope)  [open + geocoded + not-listed + deduped]
       -> BrowsePage -> MapView (slate dot layer, hover popup, no nav)
                     -> MapLegend (4 swatches / 3 toggles)
```

## Error handling & edge cases

- Missing `MAPTILER_API_KEY` or low-relevance address → row stays ungeocoded →
  omitted from the map (never errors).
- `getUnlistedHsLocations` failure → `[]`; map renders without the slate layer.
- A location listed for sale shows only as the clickable pink dot (excluded from
  slate layer by the not-listed rule).
- "Unknown Owner" directory rows are real locations and are included if open +
  geocoded (they carry no PII in the popup regardless).
- Toggling `showHsLocations` off removes the slate markers without touching the
  other layers.

## Testing

- **Query rule** (`src/__tests__/…`): open-on-suite, open-on-flagship,
  closed-suite excluded, future-closed-date treated as open, active-listing match
  excluded, unresolved-name shown, dedupe of ownership-transfer duplicates,
  scope/bounding-box filtering.
- **Geocode backfill**: maps a geocoder hit to persisted coords + `geocodedAt`;
  a null geocoder result leaves the row ungeocoded; already-geocoded rows skipped.
- **MapView**: slate layer renders only when `showHsLocations` is true and the
  markers carry no click handler; hover popup contains no owner PII.
- **MapLegend**: renders 4 swatches, 3 toggles; toggling a row flips the matching
  nuqs flag.

## Affected files

- `src/db/schema/ownerLocations.ts` — new columns + index.
- `drizzle/` migration (or `db:push` per this repo's push-managed flow).
- `src/lib/owner-directory/sync.ts` — preserve + geocode coords.
- backfill script (new).
- `src/lib/hs-locations-query.ts` — new read query.
- `src/components/browse/MapView.tsx` — slate layer.
- `src/components/browse/MapLegend.tsx` — new key component.
- `src/components/browse/FilterBar.tsx` — add `showHsLocations`; retire `LayerToggles`.
- `src/components/browse/BrowsePage.tsx` — wire props + render `MapLegend`.
- `src/app/browse/page.tsx` — fetch + pass `hsLocations`.
- tests as above.
