# Radius-Search Discoverability Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dismissible prompt pill over the Browse map that tells users to search a location to filter by distance — surfacing the radius search that is otherwise hidden until a location is selected.

**Architecture:** A new focused presentational component `RadiusSearchHint` plus a pure exported predicate `shouldShowRadiusHint(viewMode, hasCenter, dismissed)`. `BrowsePage` gains a session `hintDismissed` state and renders the hint inside the existing `relative` map panel when the predicate is true. No change to radius filtering, the geocoding control, or the map circle.

**Tech Stack:** Next.js (App Router, client components), Tailwind (Hello Sugar tokens), Vitest 4 (node env, `@vitejs/plugin-react` for JSX).

## Global Constraints

- Show the hint only when `viewMode === "map"` AND no search center is set AND not dismissed. Pure predicate: `shouldShowRadiusHint(viewMode: "list" | "map", hasCenter: boolean, dismissed: boolean): boolean` returns `viewMode === "map" && !hasCenter && !dismissed`.
- Auto-hide when a location is chosen (`searchCenter` becomes non-null); reappear if the location is cleared — UNLESS ×-dismissed (session state stays dismissed).
- Session-only dismiss (component state); no persistence across page loads (YAGNI).
- `sm`-and-up only (`hidden sm:flex`) — the location search itself is desktop-only, so the prompt must match that breakpoint.
- Exact copy: **`Search a location above to filter by distance`** (with a 📍 leading glyph).
- Style with existing Hello Sugar toolbar tokens (`border-hs-red-200`, `text-hs-red-700`, `bg-white`, rounded-full, subtle shadow) so it matches the current location/radius chips.
- Dismiss button has `aria-label="Dismiss"`.
- No change to radius filtering logic, `LocationSearch`, or `MapView`.
- Tests live in `src/__tests__/**/*.test.ts` (the vitest `include` is `*.test.ts`, NOT `.tsx`). Node env — test the pure predicate only; do not render JSX. The JSX is verified by `npm run build`.
- Test runner: `npm test` (`vitest run`). Commit after each task with the shown message.

## File Map

**Create:**
- `src/components/browse/RadiusSearchHint.tsx` — exported pure predicate `shouldShowRadiusHint` + presentational `RadiusSearchHint` component.
- `src/__tests__/browse/radius-search-hint.test.ts` — unit tests for the predicate.

**Modify:**
- `src/components/browse/BrowsePage.tsx` — add `hintDismissed` state; render the hint in the map panel.

---

### Task 1: `RadiusSearchHint` component + predicate

**Files:**
- Create: `src/components/browse/RadiusSearchHint.tsx`
- Test: `src/__tests__/browse/radius-search-hint.test.ts`

**Interfaces:**
- Produces:
  - `shouldShowRadiusHint(viewMode: "list" | "map", hasCenter: boolean, dismissed: boolean): boolean`
  - `RadiusSearchHint(props: { onDismiss: () => void }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/browse/radius-search-hint.test.ts`:
```typescript
import { describe, it, expect } from "vitest"
import { shouldShowRadiusHint } from "@/components/browse/RadiusSearchHint"

describe("shouldShowRadiusHint", () => {
  it("shows in map view with no center and not dismissed", () => {
    expect(shouldShowRadiusHint("map", false, false)).toBe(true)
  })

  it("hides once a location (center) is set", () => {
    expect(shouldShowRadiusHint("map", true, false)).toBe(false)
  })

  it("hides when dismissed", () => {
    expect(shouldShowRadiusHint("map", false, true)).toBe(false)
  })

  it("hides in list view regardless of center/dismissed", () => {
    expect(shouldShowRadiusHint("list", false, false)).toBe(false)
    expect(shouldShowRadiusHint("list", true, true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/browse/radius-search-hint.test.ts`
Expected: FAIL — cannot resolve `@/components/browse/RadiusSearchHint` (module does not exist yet).

- [ ] **Step 3: Create the component**

Create `src/components/browse/RadiusSearchHint.tsx`:
```tsx
"use client"

/** Show the radius-search hint only in map view, before a location is chosen, and not dismissed. */
export function shouldShowRadiusHint(
  viewMode: "list" | "map",
  hasCenter: boolean,
  dismissed: boolean
): boolean {
  return viewMode === "map" && !hasCenter && !dismissed
}

/**
 * A small prompt pill floated over the top of the map, pointing at the location
 * search box, that surfaces the otherwise-hidden radius filter. Desktop only.
 */
export function RadiusSearchHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="hidden sm:flex absolute top-3 left-1/2 -translate-x-1/2 z-10 items-center gap-2 rounded-full border border-hs-red-200 bg-white/95 px-4 py-2 text-sm text-hs-red-700 shadow-md backdrop-blur">
      <span aria-hidden="true">📍</span>
      <span className="whitespace-nowrap">Search a location above to filter by distance</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-1 inline-flex items-center justify-center rounded-full p-0.5 text-hs-red-400 hover:text-hs-red-600 hover:bg-hs-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/browse/radius-search-hint.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: zero errors.
```bash
git add src/components/browse/RadiusSearchHint.tsx src/__tests__/browse/radius-search-hint.test.ts
git commit -m "feat(rock-2): RadiusSearchHint component + shouldShowRadiusHint predicate"
```

---

### Task 2: Wire the hint into BrowsePage

**Files:**
- Modify: `src/components/browse/BrowsePage.tsx`

**Interfaces:**
- Consumes: `RadiusSearchHint`, `shouldShowRadiusHint` (Task 1). `searchCenter` and `viewMode` already exist in `BrowsePage`.

- [ ] **Step 1: Add the import**

In `src/components/browse/BrowsePage.tsx`, add to the existing import block (next to the other `./` browse imports, e.g. after the `LocationSearch` import on line 8):
```typescript
import { RadiusSearchHint, shouldShowRadiusHint } from "./RadiusSearchHint"
```

- [ ] **Step 2: Add the dismiss state**

In the component body, next to the other `useState` declarations (after line 37, `const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)`), add:
```typescript
  const [hintDismissed, setHintDismissed] = useState(false)
```

- [ ] **Step 3: Render the hint in the map panel**

In the map panel (the `<div className="w-full md:w-1/2 relative">` around line 264), add the hint immediately after the `<MapView ... />` element, still inside that `relative` div:
```tsx
            {/* Map panel */}
            <div className="w-full md:w-1/2 relative">
              <MapView
                listings={initialListings}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                onListingClick={handleListingClick}
                center={searchCenter}
                radiusMiles={searchCenter ? rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES : null}
              />
              {shouldShowRadiusHint(viewMode, searchCenter !== null, hintDismissed) && (
                <RadiusSearchHint onDismiss={() => setHintDismissed(true)} />
              )}
            </div>
```
(Only the `{shouldShowRadiusHint(...) && ...}` block is new — the `<MapView>` props are unchanged; shown for placement.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Full suite + build**

Run: `npm test`
Expected: all tests pass (includes the new predicate test).

Run: `npm run build`
Expected: build succeeds (pre-existing `ENOTFOUND api.hellosugar.salon` during static generation is expected and non-blocking).

- [ ] **Step 6: Commit**

```bash
git add src/components/browse/BrowsePage.tsx
git commit -m "feat(rock-2): show radius-search hint on map until a location is picked"
```

---

## Self-Review

**Spec coverage:**
- Pure predicate `shouldShowRadiusHint` with the exact rule → Task 1 Step 3. ✓
- `RadiusSearchHint` pill: 📍 + exact copy + × dismiss (`aria-label="Dismiss"`) → Task 1 Step 3. ✓
- Hello Sugar token styling (border-hs-red-200/text-hs-red-700/bg-white/rounded-full/shadow) → Task 1 Step 3. ✓
- `sm`+ only (`hidden sm:flex`) → Task 1 Step 3. ✓
- Positioned in the existing `relative` map panel, top-center (`absolute top-3 left-1/2 -translate-x-1/2 z-10`) → Task 1 Step 3 + Task 2 Step 3. ✓
- Session dismiss state + auto-hide on center set + reappear on clear (driven by `searchCenter !== null`) → Task 2 Steps 2–3. ✓
- No change to filtering/LocationSearch/MapView → only BrowsePage render + new component. ✓
- Predicate unit-tested in node env, JSX build-verified → Task 1 tests + Task 2 Step 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows literal code. ✓

**Type consistency:** `shouldShowRadiusHint(viewMode, hasCenter, dismissed)` defined Task 1, called identically in Task 2 Step 3 with `(viewMode, searchCenter !== null, hintDismissed)`. `RadiusSearchHint({ onDismiss })` defined Task 1, used with `onDismiss={() => setHintDismissed(true)}` in Task 2. `viewMode` is `"list" | "map"` in both. ✓

**Scope:** One small cohesive UI affordance, 2 tasks. ✓
