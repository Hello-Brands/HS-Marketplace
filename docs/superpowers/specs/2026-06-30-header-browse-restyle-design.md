# Header + Browse-Bar Restyle — Design

**Date:** 2026-06-30
**Status:** Approved design, pending implementation plan
**Mockup:** https://claude.ai/code/artifact/76a4bfe2-1fbe-4b35-97e5-4a4fccd0ab41
**Builds on:** the browse redesign shipped at commit 1473d9c (PR #11).

## Goal

Restyle the global header to a red (#ED1845) masthead with the white Hello Sugar
logo and high-contrast white buttons (mockup Option A), give the browse location
search a long pink-trimmed oval, remove the dead space in the filter bar, and
fold the Listings/Competitors list toggle into the existing Hello Sugar /
Competitors pills.

## Decisions (confirmed)

- Header button treatment = **Option A (solid white)**.
- Header red = **#ED1845** on **both tiers** of `HeaderNav`.
- Logo = **`public/logo-horizontal-white.png`** (copied from
  `C:\Users\Owner\Downloads\LOGO-Horizontal_White.png`, 3799×1169 RGBA), top-left,
  **replacing** the current SVG wordmark — no "Sugar / MARKETPLACE" text.
- Search trim = brand pink **#db2777**.
- Pills behavior = **list mirrors the pills**.

## Changes

### 1. Red header, Option A buttons — `src/components/layout/HeaderNav.tsx`

This is the shared header (`SiteHeader` → `HeaderNav`) used by BOTH the
marketplace and admin worlds, so the red applies app-wide. Intended.

- **Top tier** (`<header>` / first row): background `#ED1845` (replace
  `bg-white border-b border-gray-200`). Use an arbitrary Tailwind value
  `bg-[#ED1845]`. Bottom divider becomes `border-b border-white/15`.
- **Bottom tier**: replace `border-t border-gray-100 bg-gray-50/60` with
  `border-t border-white/15` (stays red). Title text → `text-white`; subtitle →
  `text-white/80`.
- **Nav links** (the `items.map` Links): Option A — base
  `text-white/90 hover:bg-white/15`, rounded-full, `px-3 py-1.5`; active
  (`aria-current`) → `bg-white text-[#ED1845] font-semibold shadow-sm`.
- **Primary action ("+ Add Listing")**: solid white pill — `bg-white
  text-[#ED1845] font-bold shadow-md hover:bg-white/90`, rounded-full.
- **Hamburger** (mobile trigger): icon `text-white`, `hover:bg-white/15`.
- **Mobile drawer**: unchanged (it's a white overlay panel); only its trigger
  sits on red. Active-item styling inside the drawer stays as-is.
- Keep the `max-w-7xl` widths, sticky behavior, and structure.

### 2. WorldSwitcher (Marketplace/Admin) — `src/components/layout/WorldSwitcher.tsx`

Restyle for red, Option A: track `bg-white/18` rounded-lg; active segment
`bg-white text-[#ED1845]`; inactive `text-white hover:bg-white/10`. (Admin-only
control; unaffected for non-admins.)

### 3. Logo — `src/components/layout/Logo.tsx` + asset

- Copy `LOGO-Horizontal_White.png` → `public/logo-horizontal-white.png`.
- `Logo.tsx`: render `<img src="/logo-horizontal-white.png" alt="Hello Sugar"
  className="h-8 w-auto" />`. Remove the `gap-2` wordmark layout remnants; the
  link still wraps the image and points to `logoHref`.
- The old `public/hello-sugar-logo.svg` may remain in the repo (unused) — do not
  delete in this change.

### 4. Location search — long pink oval — `globals.css` + `FilterBar.tsx`

- **`src/app/globals.css`** `.hs-geocoder--lg input`: keep `height: 52px`,
  pill radius; add `border: 2px solid #db2777;` and a soft glow
  `box-shadow: 0 1px 3px rgba(219,39,119,0.12);`. The search icon stays as the
  control renders it. (The focus outline rule already exists.)
- **`src/components/browse/FilterBar.tsx`**: the prominent search wrapper changes
  from a fixed `w-[320px] lg:w-[360px]` to a growing oval that fills the dead
  space: `hidden md:block flex-1 max-w-[520px]`. **Remove** the
  `hidden md:block h-7 w-px bg-gray-200` divider that followed it. The Listing
  Type / Price / Filters pills then sit directly after the search with the
  existing `gap-3`, eliminating the empty gap.
- Net effect: one long pink-trimmed oval, no void before the pills.

### 5. Fold Listings/Competitors toggle into the pills — `src/components/browse/BrowsePage.tsx`

- **Remove** the `listMode` state and the `competitorClosures.length > 0 && (…)`
  segmented "Listings | Competitors" control on the second row.
- The Hello Sugar / Competitors pills (`LayerToggles`, driving
  `showListings` / `showCompetitors` in the URL) now drive **both** the map
  (unchanged) and the left list.
- **List content rule** (applies in both list view and the map-view left panel):
  - `showListings && showCompetitors` → render `ListingGrid` **and**
    `CompetitorList` stacked, each under a small heading ("Hello Sugar listings"
    / "Competitors"). The competitor block renders only if
    `competitorClosures.length > 0`.
  - `showListings` only → `ListingGrid`.
  - `showCompetitors` only → `CompetitorList` (or its empty state if no closures).
  - neither on → a short empty state: "Turn on Hello Sugar or Competitors to see
    results."
- Extract the selection into a tiny pure helper (e.g. `listSections(showListings,
  showCompetitors, hasCompetitors)` returning which blocks to show) so it can be
  unit-tested without rendering.

## Components & boundaries

Each change is local: `HeaderNav`/`WorldSwitcher`/`Logo` (chrome), `globals.css`
+ `FilterBar` (search styling/layout), `BrowsePage` (list-content logic). No data
model, query, or server-action changes.

## Error handling & edge cases

- **No competitor data:** competitor list block / pill still toggle, but the
  competitor section shows its existing empty state; with both layers on and no
  closures, only the listings block renders.
- **Neither layer on:** explicit empty state (above) instead of a blank panel.
- **White-on-red contrast:** #ED1845 with white is acceptable for UI/large text;
  active states use white pills with red text for strong contrast. This is the
  user's chosen brand color.
- **Logo:** white PNG is invisible except on the red bar — which is the only
  place it renders.

## Testing

- `npx tsc --noEmit` clean; full Vitest suite stays green.
- Unit test the pure `listSections` helper (both-on / listings-only /
  competitors-only / neither; and competitors-on-but-no-closures).
- Manual visual check against the mockup (desktop + mobile drawer trigger).
- Per project memory: no `next build` while dev server runs; no `npm run lint`.

## Out of scope

- No change to map rendering, filters, queries, or the inventory feature.
- Not deleting the old logo SVG.
- No redesign of the listing cards or detail page.
