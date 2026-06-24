# Browse: map-default view + working location search (city/state/ZIP) with pin & radius

**Date:** 2026-06-23
**Status:** Approved (design)
**Area:** Marketplace browse page (`src/app/browse`, `src/components/browse/*`)

## Problem

On the marketplace browse page:

1. The default view is the list; we want the **map** to be the default.
2. Location search by city/state/ZIP doesn't work in practice — typing (e.g.
   "Salt Lake City") shows **no autocomplete suggestions**, so a user can never
   select a place, and therefore the search **center pin and radius never
   appear**.

Diagnosis from exploration:

- The search uses MapTiler's `@maptiler/geocoding-control` (`GeocodingControl`)
  keyed on `NEXT_PUBLIC_MAPTILER_API_KEY`.
- That public key is (per `.env.example`) intended to be **referer-restricted
  to the production domain**, so in-browser geocoding requests are blocked on
  non-allowlisted origins (localhost), returning no suggestions. The same key
  works server-side (no `Referer` header) — confirmed: both keys return HTTP 200
  with features for "Salt Lake City".
- `MapView` only ever draws a translucent **radius circle** (no distinct center
  marker) when `center && radiusMiles` are set.
- The whole search UI lives in a `hidden sm:flex` container — **desktop only**.

## Goals

- Map is the default view on all screen sizes.
- Location search reliably shows suggestions (localhost **and** production) and,
  on select, drops a clear center pin and draws the radius circle, zooming to
  fit.
- Search is usable on mobile.

## Non-goals

- Replacing MapTiler `GeocodingControl` with a custom autocomplete (considered;
  rejected in favor of keeping and fixing the existing widget).
- Draggable center pin / reverse geocoding (static pin only this pass).
- Changes to listing data, radius filtering math, or the server listings query
  (the existing radius filter and `circlePolygon` overlay are unchanged).

## Approach (decided)

Keep `GeocodingControl`; fix it at the root by proxying its requests through our
own server route so the **unrestricted server key** is used and the public-key
referer restriction is bypassed. Add a center pin in `MapView`. Surface search
on mobile. Default to map.

### 1. Map as default view

`BrowsePage` initial `viewMode` state: `"list"` → `"map"`. The list/map toggle
and all existing view logic are unchanged; list remains one click away.

### 2. Server-side geocoding proxy

New route: `GET /api/geocode/[...q]/route.ts`.

- The widget requests `${apiUrl}/<query>.json?key=…&country=…&types=…&proximity=…&autocomplete=…&limit=…`.
  With `apiUrl="/api/geocode"`, that hits `/api/geocode/<query>.json`.
- The route:
  - Reconstructs the query from the catch-all segment(s), stripping the trailing
    `.json`.
  - Forwards to `https://api.maptiler.com/geocoding/<query>.json`, **injecting
    `MAPTILER_API_KEY`** (server, unrestricted) as `key` and ignoring any
    client-supplied key.
  - Passes through the safe MapTiler params actually sent by the widget
    (`country`, `types`, `proximity`, `autocomplete`, `limit`, `language`,
    `bbox`, `fuzzyMatch`) via an allowlist; drops anything else.
  - Returns MapTiler's JSON body verbatim with its content-type. On upstream
    error, returns the upstream status (so the widget degrades gracefully).
  - Returns 503 if `MAPTILER_API_KEY` is unset.
- Server-only; the unrestricted key never reaches the client.

A small **pure helper** builds the upstream URL from `(querySegments, incoming
searchParams)` and is unit-tested (key injection, param allowlist, `.json`
stripping).

### 3. `LocationSearch` widget config

- `apiUrl="/api/geocode"` (route above). Keep `apiKey` only as a placeholder the
  proxy ignores (or omit if the widget allows; verified at build time).
- `country: ["US"]`, `types: ["place","postcode","region"]`, a US `proximity`
  bias so city names resolve to the right state, a sensible `limit` (~5).
- Brand the input + dropdown via the control's `class` option plus a scoped CSS
  override (Montserrat, HS crimson focus/hover, rounded corners).
- Ensure the suggestions dropdown renders **above** the map and isn't clipped by
  parent containers (z-index / overflow).
- `onPick` behavior unchanged: fire `onSelect({ lng, lat, name })`.

### 4. Center pin + radius in `MapView`

- Keep the existing radius circle (`circlePolygon`) and fit-to-bounds.
- Add an **HS-branded center pin** marker, visually distinct from the pink
  listing dots (e.g. a larger teardrop/pin in crimson), placed at `center`.
  Created when `center` is set, moved when it changes, removed when cleared.
  Implemented with the same MapTiler `Marker` pattern already used for listings
  (outer element untouched by us; visuals on an inner element).

### 5. `handleLocationSelect` / radius

Unchanged: sets `centerLat/Lng`, `centerLabel`, and `radiusMiles`
(`?? DEFAULT_RADIUS_MILES`), and switches to map view. Because map is now the
default, selection from map view simply updates the pin/circle in place.

### 6. Mobile search

- Remove the desktop-only gate so `LocationSearch` (and the radius select + clear
  chip that appears once a center is set) is available on mobile, laid out in a
  compact row in the controls area above the map without crowding the
  list/map toggle. Verify it doesn't overlap the mobile "Filters" button.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `/api/geocode/[...q]/route.ts` | Proxy geocoding with server key; param allowlist | `MAPTILER_API_KEY`, pure URL builder |
| geocode URL builder (pure) | Build upstream URL from segments + params | — (unit-tested) |
| `LocationSearch` | Render widget, point at proxy, fire `onSelect` | `GeocodingControl`, `/api/geocode` |
| `MapView` | Listing markers, center pin, radius circle | `@maptiler/sdk`, `NEXT_PUBLIC_MAPTILER_API_KEY` (tiles) |
| `BrowsePage` | View state (map default), wire select → center/radius, layout (incl. mobile) | the above |

Note: map **tiles** still use `NEXT_PUBLIC_MAPTILER_API_KEY` directly (that key
works for tiles on allowlisted origins; only geocoding needed the proxy). If
tiles also fail on localhost, the same allowlist note applies — out of scope to
change tile auth here.

## Error handling

- Proxy: missing server key → 503; upstream non-200 → pass through status +
  body; the widget shows no/empty results rather than crashing.
- `MapView`: pin/circle effects already guard on `map.current` and `mapReady`;
  clearing the center removes pin + circle.

## Testing

- **Unit:** geocode URL builder — server key injected, client key ignored, param
  allowlist enforced, `.json` stripped, query reconstructed from segments.
- **Regression:** existing `shouldShowRadiusHint` test stays green.
- **Manual (run the app):** confirm the exact widget failure cause, then verify
  suggestions appear on localhost, selecting a place drops the pin + circle and
  zooms, search works on mobile, and map is the default view. `tsc --noEmit`
  and `npm run build` clean.

## Risks / things to verify at build time

- Exact request shape the widget builds from `apiUrl` (path + params) — confirm
  by watching the network call; shape the route to match.
- Whether the dropdown failure is the referer (most likely) or a CSS clip — the
  proxy fixes the former; CSS/z-index fix covers the latter. Apply whichever the
  running app shows is needed.
- Mobile layout fit alongside the existing Filters button and view toggle.
