# Mobile Browse Zillow-Style Overhaul — Design

**Date:** 2026-07-23
**Branch:** `mobile-ux-updates`
**Status:** Approved design, pending implementation plan

## Goal

Overhaul the mobile (`< md`) browse experience to match Zillow's mobile-web
patterns: minimal top chrome, map as the primary surface, floating view-toggle
pills, a persistent bottom tab bar, a purpose-built full-screen filter sheet,
and favorites hearts on listing cards.

Desktop layout is explicitly untouched (shared components may be refactored,
but desktop rendering and behavior must not change).

## Decisions (from brainstorm)

| Decision | Choice |
| --- | --- |
| Scope | Mobile-first; desktop untouched |
| Bottom tab bar | Yes — Browse / Saved / Alerts / My Listings (capability-gated) |
| Map markers | Keep brand swirl markers (no price pills) |
| Map key on mobile | Layers button → bottom sheet; desktop keeps current legend |
| Mobile filters | Full-screen sheet, live-applied via nuqs, sticky "Show N results" footer |
| Mobile header | Zillow-tight 2 rows; "Browse Listings" banner hidden on mobile |
| List/map relationship | Approach A: hard toggle with floating pills (no draggable sheet) |
| Extras | Favorites hearts on cards; view mode promoted to URL param; unified scroll lock |

## 1. Mobile browse header (2 rows)

- **Row 1 (red bar):** compact HS logo mark · white rounded search field
  (existing MapTiler `GeocodingControl`, restyled) · hamburger button.
  The "Browse Listings" title banner tier is hidden on mobile for `/browse`
  only; desktop keeps the current two-tier header everywhere.
- **Row 2 (white pill row):** `Filters` pill with active-filter count badge ·
  `Save search` pill · radius chip (only when a search center is active).
  Horizontally scrollable if content overflows.
- Implemented as a browse-specific mobile variant/slot on
  `SiteHeader`/`HeaderNav` (`src/components/layout/`). Other pages' headers
  render exactly as before.

## 2. Bottom tab bar (mobile, marketplace pages)

- New `MobileTabBar` component: `fixed bottom-0`, `md:hidden`, safe-area
  padding via the existing `pb-safe` utilities (`viewport-fit=cover` is
  already set in `layout.tsx`).
- Tabs sourced from `MARKETPLACE_NAV` (`src/lib/navigation.ts`) with its
  existing capability gating: **Browse · Saved · Alerts · My Listings**
  (My Listings appears for sellers only). Active tab derived from pathname.
- No "Menu" tab: account, world switch, and sign-out remain in the hamburger
  drawer.
- Rendered on marketplace pages only (not admin). Content panels get bottom
  padding so the bar never covers cards or map controls.

## 3. Map view (mobile)

- Map fills everything between header and tab bar. The load-bearing
  `h-[100dvh] overflow-hidden` clamp chain (`src/app/browse/page.tsx` →
  `BrowsePage.tsx`) is preserved; the tab bar joins the flex column.
- Floating **"List"** pill, bottom-center, above the tab bar.
- `MapLegend` panel hidden on mobile. Replacement: circular **layers button**
  stacked near the existing zoom/geolocate controls that opens a
  **bottom sheet** containing the same layer-toggle rows, driving the same
  nuqs flags (`showListings`, `showCompetitors`, `showHsLocations`,
  `showMyLocations`). Desktop keeps the current legend untouched.
- Swirl markers, radius circle, and `RadiusSearchHint` coach-mark unchanged.
- Mobile map controls: keep zoom + geolocate; drop compass/pitch control on
  mobile only.

## 4. List view (mobile)

- Full-width vertical `ListingCard`s, infinite scroll unchanged
  (`ListingGrid`, cursor pagination, `react-intersection-observer`).
- Floating **"Map | Sort"** pill bottom-center. **Sort** opens a small bottom
  sheet exposing the existing sort options (today a `<select>` inside
  `FilterBar`); selection writes the same nuqs sort param.
- **View mode → URL:** `viewMode` moves from `useState` in `BrowsePage` to a
  nuqs param (`view=map|list`, default `map`). Shareable and reload-safe.
  Existing auto-switch behaviors (selecting a competitor/location on mobile
  flips to map) now write the param instead of calling `setState`.

## 5. Favorites hearts on cards

- Heart button, top-right of the card photo, minimum 44px touch target.
- Optimistic toggle backed by the existing `favorites` table and the
  favorites server actions used by `/account/favorites`; if no toggle action
  exists yet, add one alongside them.
- Wired through the `favoriteIds` prop that already flows into `ListingGrid`
  but currently renders nothing (`ListingGrid.tsx` line ~16).
- The heart is a `<button>` layered inside the card's `<Link>` wrapper — it
  must stop propagation/navigation on tap.
- Appears on both card layouts (default + `compact`), so desktop gains the
  heart too — a visual-only addition that does not alter desktop layout.
- Page is already auth-gated, so no signed-out state is needed on `/browse`.

## 6. Full-screen filter sheet (mobile)

- New `MobileFilterSheet` replaces `MobileFilterDrawer` (which currently
  stuffs the desktop `FilterBar` into a right-side drawer).
- Slides up full-screen: header ("Filters" + close X), stacked sections —
  Location/radius, Listing type, Price, Keyword, State, and the remaining
  facets `FilterBar` exposes — each as a plain stacked group, no popovers.
- Sticky footer: **"Show N results"** (live count) + **"Clear all"**.
- Filters remain **live-applied** through the same `useListingFilters()` nuqs
  hooks desktop uses (`{ shallow: false }` refetch behavior unchanged). The
  footer button just closes the sheet. No staged/draft filter state.
- Desktop `FilterBar` is untouched.

## 7. Shared primitives & cleanup

- **`BottomSheet`** (used by layers + sort): hand-rolled to match the repo's
  no-Radix convention — backdrop, slide-up animation, Escape/outside-tap
  close, focus handling consistent with existing overlay patterns.
- **`FullScreenSheet`** (used by filters): same conventions, full-height.
- **`useScrollLock`** hook replacing the two competing mechanisms
  (`body.drawer-open` class in `HeaderNav` vs inline `body.style.overflow`
  in `MobileFilterDrawer`). All overlays (existing drawer included) migrate
  to it.
- New primitives live in `src/components/ui/` and export via its `index.ts`.

## 8. Out of scope

- Desktop layout/behavior changes.
- Price-pill map markers (swirls stay).
- Card photo carousels.
- Draggable list-over-map bottom sheet (Approach B — possible later layer).
- Result-count chips on the map.
- Bottom nav on admin pages.

## Error handling

- Favorite toggle failure: revert optimistic state, show existing toast/error
  pattern used elsewhere in the app.
- Geocoder/map failures: unchanged from current behavior.
- Sheets must be dismissible even if content fails to load (close is never
  blocked on data).

## Testing

- Vitest units for `useScrollLock`, view-mode URL param behavior, and the
  favorite-toggle optimistic logic where extractable.
- `tsc` gate per implementation step (not `next build`, per Windows dev-server
  lock constraint).
- Manual visual verification at a 390px viewport against the Zillow reference
  screenshots (dev server started only with user approval).
- Desktop regression pass: browse split view, legend, FilterBar, and header on
  `md+` must be pixel-unchanged.
