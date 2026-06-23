# Radius-Search Discoverability Prompt — Design

**Date:** 2026-06-22
**Branch:** rock-2
**Status:** Approved (design)

## Problem

On the Browse page's Map view, radius filtering works but is undiscoverable: the
"Within [X] mi" control is hidden until a search center is set, and the center is only
set by selecting a result from the "Search by city, state, or zip…" box. Nothing on first
load signals that searching a location enables distance filtering, so users don't find it.

## Solution

When the user is in **Map view with no location selected**, float a small prompt pill over
the top of the map panel pointing toward the search box:
**"📍 Search a location above to filter by distance."** It disappears automatically once a
location is chosen (the existing radius control + map circle take over), and carries a small
**×** to dismiss it for the session.

This is a discoverability affordance only — no change to the radius filtering logic, which
already works.

## Components

### 1. `src/components/browse/RadiusSearchHint.tsx` (new)
- **Pure visibility predicate (exported for tests):**
  ```ts
  export function shouldShowRadiusHint(
    viewMode: "list" | "map",
    hasCenter: boolean,
    dismissed: boolean
  ): boolean {
    return viewMode === "map" && !hasCenter && !dismissed
  }
  ```
- **Presentational component** `RadiusSearchHint({ onDismiss }: { onDismiss: () => void })`:
  an absolutely-positioned pill (📍 + copy + × button). Styled with the existing Hello Sugar
  toolbar tokens (`bg-white`, `border-hs-red-200`, `text-hs-red-700`, rounded-full, subtle
  shadow) so it matches the current location/radius chips. The × calls `onDismiss`; it has an
  `aria-label="Dismiss"`.

### 2. `src/components/browse/BrowsePage.tsx` (modify)
- Add session state: `const [hintDismissed, setHintDismissed] = useState(false)`.
- In the map panel's existing `relative` container (around line 264), render:
  ```tsx
  {shouldShowRadiusHint(viewMode, searchCenter !== null, hintDismissed) && (
    <RadiusSearchHint onDismiss={() => setHintDismissed(true)} />
  )}
  ```
- No other logic changes. `searchCenter` already exists (line 43); `viewMode` already exists.

## Behavior / data flow
- Shows when: `viewMode === "map"` AND `searchCenter === null` AND not dismissed.
- Auto-hides when a location is picked (`searchCenter` becomes non-null via the existing
  `handleLocationSelect`).
- Reappears if the user clears the location (`handleClearLocation` resets `searchCenter` to
  null) — UNLESS they ×-dismissed it (session state stays dismissed).
- Session-only: `hintDismissed` is component state, not persisted across page loads (YAGNI).

## Placement & responsiveness
- Positioned `absolute top-3 left-1/2 -translate-x-1/2 z-10` inside the map panel (the panel
  is already `relative`), so it sits at the top-center of the map, just under the toolbar
  where the search box lives.
- **`sm`-and-up only** (`hidden sm:flex`): on mobile the location search itself is hidden
  (`hidden sm:flex` in the toolbar), so the prompt must match that breakpoint or it would
  point at a control that isn't there.
- Must not block map interaction beyond its own footprint; it's a small pill, not a full
  overlay.

## Testing
- `src/__tests__/browse/radius-search-hint.test.ts`: unit-test `shouldShowRadiusHint` truth
  table —
  - map + no center + not dismissed → `true`
  - map + center set → `false`
  - map + dismissed → `false`
  - list view (any center/dismissed) → `false`
- The JSX is verified by `npm run build` + manual check (matches the codebase convention of
  unit-testing logic and build-verifying presentational markup; no React-testing infra is
  added).

## Out of scope (YAGNI)
- No persistence of the dismiss across page reloads (session only).
- No mobile location-search redesign (radius search is already desktop-only).
- No change to radius filtering, the geocoding control, or the map circle.
