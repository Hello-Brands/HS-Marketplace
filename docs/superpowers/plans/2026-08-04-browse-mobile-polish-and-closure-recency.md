# Browse Mobile Polish, Map Layering, and New-Closure Recency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship six cosmetic/UX fixes to `/browse` — mobile header and tab-bar collisions, a collapsed-by-default Hello Sugar listings section, explicit map marker stacking, a for-sale/owned icon swap, and a 14-day new-closure highlight.

**Architecture:** Five of six changes are pure presentation. Because this repo's vitest runs in a **node** environment and only collects `src/__tests__/**/*.test.ts`, component rendering cannot be tested — so every decision worth guarding is extracted into a pure, importable module (`src/lib/browse/map-markers.ts`, `src/lib/closure-recency.ts`, an extended `src/lib/browse-list-sections.ts`) and the components become thin consumers. Visual outcomes are verified by screenshot, not by assertion.

**Tech Stack:** Next.js App Router (client components), TypeScript, Tailwind v4 (`@theme` with the brand palette remapped over all stock palettes), MapTiler SDK (`@maptiler/sdk`) with **DOM** markers, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-04-browse-mobile-polish-and-closure-recency-design.md`

**Branch:** `feature/browse-mobile-polish-and-closure-recency`, already cut from `origin/main` @ `07395ec`. The spec is committed at `e6d8b43`.

## Global Constraints

- **Never touch a MapTiler marker's OUTER element `transform`.** The SDK rewrites it every frame; setting it detaches markers (they jump to 0,0 or lag while panning). `z-index` on the outer element **is** safe — the SDK does not set it. All visuals and hover animation live on an inner child. This is documented in `MapView.tsx` and is load-bearing for Tasks 3 and 6.
- **`competitor_opportunities` is scraper-owned and strictly read-only.** No INSERT/UPDATE/DELETE, no schema change, no migration in this plan.
- **`closedAt` means "first DETECTED closed", not "closed on".** User-facing copy says "Detected". Never "Closed on".
- **Tests are `.ts` only, node environment.** `vitest.config.mts` sets `environment: "node"` and `include: ["src/__tests__/**/*.test.ts"]`. There are zero `.test.tsx` files. Do not write component render tests. Pure helpers may be exported from a `.tsx` file and imported by a `.ts` test — the existing precedent is `shouldShowRadiusHint` in `RadiusSearchHint.tsx`, tested by `src/__tests__/browse/radius-search-hint.test.ts`.
- **`MapView.tsx` can never be imported by a test.** It imports `@maptiler/sdk` and `@maptiler/sdk/dist/maptiler-sdk.css` at module scope, which will not resolve under the node test environment. Any logic that needs a test must live outside it.
- **Brand colors:** components use Tailwind classes (the `@theme` block in `globals.css` remaps `amber-*`, `emerald-*` etc. to brand values — this is intentional, never "fix" it). Code that hands colors to MapTiler as inline HTML/SVG strings must use the hex constants in `src/lib/brand-colors.ts`, and every value there must match its `globals.css` token exactly.
- **Verification commands:** `npx tsc --noEmit` is the per-step type gate. `npm test` runs vitest. `npm run lint` is **broken pre-existing** — do not treat its failure as your regression. `next build` requires the dev server stopped (Windows `.next` lock).
- **Never start the dev server unprompted.** Tasks that need a running app stop and ask the user to start it.
- New-closure window: **14 days**, in exactly one named constant.
- Layer stacking, top to bottom: **competitor closures (40) → for-sale listings (30) → locations you own (20) → unlisted Hello Sugar (10)**, hover lifts +5 within the band.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/browse/map-markers.ts` | **create** | Pure marker rules: icon-variant selection, stacking layer selection, z-index bands. No SDK import, so it is testable and shared by the map and the legend. |
| `src/lib/closure-recency.ts` | **create** | The 14-day window constant + `isNewClosure()`. Pure, no `server-only`. |
| `src/lib/browse-list-sections.ts` | modify | Gains `collapsibleListings` — the tested "collapse only when both sections render" rule. |
| `src/components/browse/MapView.tsx` | modify | Consumes `map-markers` for icons + z-index; restructures the competitor marker DOM for the star; sets base z-index and resets to base on hover-out. |
| `src/components/browse/MapLegend.tsx` | modify | Swatches follow `MARKER_ICON` so the key can't drift from the map; adds a "New closure" key row. |
| `src/components/browse/CompetitorList.tsx` | modify | Gold `NEW` pill. |
| `src/components/browse/BrowseListContent.tsx` | modify | Collapse toggle + count badge for the listings block. |
| `src/components/layout/HeaderNav.tsx` | modify | Hides the logo on mobile when a search slot is present. |
| `src/components/layout/MobileTabBar.tsx` | modify | `"Brands"` short label via an exported `tabLabel()`; structurally wrap-proof tabs. |
| `src/app/globals.css` | modify | `hs-new-closure-pulse` keyframe + reduced-motion opt-out. |
| `src/lib/brand-colors.ts` | modify | Adds `gold` (`--color-amber-400`) for the map star. |
| `src/__tests__/browse/map-markers.test.ts` | **create** | Variant, layer, and z-index band assertions. |
| `src/__tests__/closure-recency.test.ts` | **create** | Window boundary, null, unparseable, future. |
| `src/__tests__/browse-list-sections.test.ts` | modify | Existing 6 `toEqual` assertions gain the new key + collapse cases. |
| `src/__tests__/navigation.test.ts` | modify | Guard: every marketplace tab label is a single word. |

## Deviations from the spec (approved changes, called out for the reviewer)

1. **The spec says `browse-list-sections.ts` needs no change.** It does. The spec proposed asserting the collapse rule "through a component render", which this repo cannot do (node environment, `.ts`-only glob). Extending `listSections()` puts the rule in a module that already has a test file. Task 2.
2. **The spec says the legend swatches "must swap to match".** Stronger fix: both the map and the legend now read `MARKER_ICON` from `src/lib/browse/map-markers.ts`, so they cannot drift again. Tasks 1 and 3.
3. **`BRAND.gold` is a new token.** The spec called for a gold star but `brand-colors.ts` has no gold. `--color-amber-400` (`#CE9E58`) already exists in `globals.css`; Task 5 adds only the mirror constant, no new CSS variable.

---

## Task 1: Pure marker rules module

Extracts every marker decision out of the untestable `MapView.tsx`. Nothing consumes it yet — Task 3 wires it in.

**Files:**
- Create: `src/lib/browse/map-markers.ts`
- Test: `src/__tests__/browse/map-markers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type MarkerLayer = "competitor" | "forSale" | "owned" | "unlistedHs"`
  - `type MarkerVariant = "forSale" | "owned" | "unlisted"`
  - `type HsMarkerKind = "listing" | "hsLocation"`
  - `const MARKER_ICON: Record<MarkerVariant, string>`
  - `const MARKER_Z_BASE: Record<MarkerLayer, number>`
  - `markerVariant(kind: HsMarkerKind, isMine: boolean): MarkerVariant`
  - `hsMarkerLayer(kind: HsMarkerKind, isMine: boolean): MarkerLayer`
  - `markerZIndex(layer: MarkerLayer, hovered?: boolean): string`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/browse/map-markers.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  MARKER_ICON,
  MARKER_Z_BASE,
  markerVariant,
  hsMarkerLayer,
  markerZIndex,
} from "@/lib/browse/map-markers"

describe("markerVariant", () => {
  it("gives a for-sale listing the wordmark badge variant", () => {
    expect(markerVariant("listing", false)).toBe("forSale")
  })
  it("gives an unlisted Hello Sugar salon the white swirl variant", () => {
    expect(markerVariant("hsLocation", false)).toBe("unlisted")
  })
  it("lets ownership outrank for-sale status", () => {
    expect(markerVariant("listing", true)).toBe("owned")
  })
  it("marks an owned unlisted salon owned too", () => {
    expect(markerVariant("hsLocation", true)).toBe("owned")
  })
})

describe("MARKER_ICON", () => {
  // The swap: the loud wordmark badge now flags what a buyer is here for.
  it("points for-sale at the wordmark badge asset", () => {
    expect(MARKER_ICON.forSale).toBe("/markers/hs-marker-owner.png")
  })
  it("points owned at the red swirl asset", () => {
    expect(MARKER_ICON.owned).toBe("/markers/hs-marker-color.png")
  })
  it("leaves unlisted on the white swirl asset", () => {
    expect(MARKER_ICON.unlisted).toBe("/markers/hs-marker-white.png")
  })
})

describe("hsMarkerLayer", () => {
  it("puts a non-owned listing in the for-sale band", () => {
    expect(hsMarkerLayer("listing", false)).toBe("forSale")
  })
  it("puts a non-owned salon in the unlisted band", () => {
    expect(hsMarkerLayer("hsLocation", false)).toBe("unlistedHs")
  })
  it("puts anything owned in the owned band", () => {
    expect(hsMarkerLayer("listing", true)).toBe("owned")
    expect(hsMarkerLayer("hsLocation", true)).toBe("owned")
  })
})

describe("MARKER_Z_BASE", () => {
  it("stacks competitors on top and unlisted salons at the bottom", () => {
    expect(MARKER_Z_BASE.competitor).toBeGreaterThan(MARKER_Z_BASE.forSale)
    expect(MARKER_Z_BASE.forSale).toBeGreaterThan(MARKER_Z_BASE.owned)
    expect(MARKER_Z_BASE.owned).toBeGreaterThan(MARKER_Z_BASE.unlistedHs)
  })
})

describe("markerZIndex", () => {
  it("returns the base band as a style-ready string", () => {
    expect(markerZIndex("competitor")).toBe("40")
    expect(markerZIndex("unlistedHs")).toBe("10")
  })
  it("lifts a hovered marker above its own layer", () => {
    expect(Number(markerZIndex("owned", true))).toBeGreaterThan(
      Number(markerZIndex("owned"))
    )
  })
  it("never lets a hovered marker cross into the layer above", () => {
    // The whole point of 10-wide bands: hovering a for-sale pin must not
    // raise it over a competitor closure.
    expect(Number(markerZIndex("forSale", true))).toBeLessThan(
      MARKER_Z_BASE.competitor
    )
    expect(Number(markerZIndex("owned", true))).toBeLessThan(
      MARKER_Z_BASE.forSale
    )
    expect(Number(markerZIndex("unlistedHs", true))).toBeLessThan(
      MARKER_Z_BASE.owned
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/browse/map-markers.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/browse/map-markers"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/browse/map-markers.ts`:

```ts
/**
 * Pure selection rules for the /browse map's DOM markers — which brand asset a
 * marker renders, and how the four marker populations stack.
 *
 * Deliberately free of any `@maptiler/sdk` or `server-only` import: MapView.tsx
 * pulls in the MapTiler SDK *and its CSS* at module scope, so it can never be
 * imported by a vitest (node-environment) test. Keeping these rules here is
 * what makes them testable, and it lets MapLegend read the same MARKER_ICON so
 * the on-map key cannot drift from the map again.
 */

/** The four marker populations the browse map draws. */
export type MarkerLayer = "competitor" | "forSale" | "owned" | "unlistedHs"

/** Which brand asset a Hello Sugar marker renders. */
export type MarkerVariant = "forSale" | "owned" | "unlisted"

/** Which of the two Hello Sugar marker effects a marker came from. */
export type HsMarkerKind = "listing" | "hsLocation"

export const MARKER_ICON: Record<MarkerVariant, string> = {
  // The wide "Hello Sugar" wordmark on a red field — the loudest mark in the
  // set, so it flags the thing a buyer opened /browse for: an actual for-sale
  // salon. (Before 2026-08-04 this asset marked owned locations, which is why
  // its filename still says "owner".)
  forSale: "/markers/hs-marker-owner.png",
  // Red swirl glyph — salons the viewer owns.
  owned: "/markers/hs-marker-color.png",
  // White swirl glyph — an open Hello Sugar salon that is not for sale.
  unlisted: "/markers/hs-marker-white.png",
}

/**
 * Brand mark for a Hello Sugar marker. Ownership outranks for-sale status: an
 * owned listing and an owned unlisted salon both render `owned`, and their
 * popups carry the distinction. (That was already true when both rendered the
 * wordmark badge, so it is not a new limitation.)
 *
 * `isMine` is expected to be pre-gated on the "Your locations" legend toggle by
 * the caller, so flipping that toggle off returns markers to their layer's
 * normal mark.
 */
export function markerVariant(kind: HsMarkerKind, isMine: boolean): MarkerVariant {
  if (isMine) return "owned"
  return kind === "listing" ? "forSale" : "unlisted"
}

/** Stacking layer for a Hello Sugar marker — same shape as markerVariant. */
export function hsMarkerLayer(kind: HsMarkerKind, isMine: boolean): MarkerLayer {
  if (isMine) return "owned"
  return kind === "listing" ? "forSale" : "unlistedHs"
}

/**
 * Base stacking order. Competitor closures sit on top — they are what owners
 * open /browse for — and unlisted Hello Sugar salons sit at the bottom.
 *
 * Bands are 10 apart for two reasons: a hovered marker can lift within its own
 * band without crossing the layer above, and a future layer can be inserted
 * without renumbering.
 */
export const MARKER_Z_BASE: Record<MarkerLayer, number> = {
  competitor: 40,
  forSale: 30,
  owned: 20,
  unlistedHs: 10,
}

/** How far a hovered marker lifts. Must stay under the 10-wide band gap. */
const HOVER_LIFT = 5

/**
 * z-index for a marker, as a string ready for `element.style.zIndex`.
 *
 * Callers MUST use this for the non-hovered case too. Resetting a marker's
 * zIndex to "" on hover-out (as the code did before base bands existed) would
 * silently drop it back to accidental DOM order.
 */
export function markerZIndex(layer: MarkerLayer, hovered = false): string {
  return String(MARKER_Z_BASE[layer] + (hovered ? HOVER_LIFT : 0))
}
```

- [ ] **Step 4: Run tests + type gate**

Run: `npx vitest run src/__tests__/browse/map-markers.test.ts && npx tsc --noEmit`
Expected: all tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/browse/map-markers.ts src/__tests__/browse/map-markers.test.ts
git commit -m "feat(browse): pure marker variant + stacking rules module

Extracts icon selection and z-index bands out of MapView.tsx, which can
never be unit tested (imports the MapTiler SDK and its CSS at module
scope). MARKER_ICON also becomes the single source the legend reads, so
the on-map key can't drift from the map.

Encodes the icon swap (for-sale takes the wordmark badge, owned takes the
red swirl) and the stacking order: competitors 40 > for-sale 30 > owned
20 > unlisted 10, hover +5 within the band."
```

---

## Task 2: Collapse rule for the listings section

**Files:**
- Modify: `src/lib/browse-list-sections.ts`
- Modify: `src/__tests__/browse-list-sections.test.ts`
- Modify: `src/components/browse/BrowseListContent.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ListSections` gains `collapsibleListings: boolean`. `listSections(showListings, showCompetitors, hasCompetitors)` keeps its existing 3-arg signature.

- [ ] **Step 1: Write the failing test**

The 6 existing cases in `src/__tests__/browse-list-sections.test.ts` use `toEqual` on the whole object, so each needs the new key. Replace the file's body with:

```ts
import { describe, it, expect } from "vitest"
import { listSections } from "@/lib/browse-list-sections"

describe("listSections", () => {
  it("shows both blocks when both layers on and competitors exist", () => {
    expect(listSections(true, true, true)).toEqual({
      listings: true, competitors: true, empty: false, collapsibleListings: true,
    })
  })
  it("shows only listings when only Hello Sugar is on", () => {
    expect(listSections(true, false, true)).toEqual({
      listings: true, competitors: false, empty: false, collapsibleListings: false,
    })
  })
  it("shows only competitors when only Competitors is on and data exists", () => {
    expect(listSections(false, true, true)).toEqual({
      listings: false, competitors: true, empty: false, collapsibleListings: false,
    })
  })
  it("is empty when neither layer is on", () => {
    expect(listSections(false, false, true)).toEqual({
      listings: false, competitors: false, empty: true, collapsibleListings: false,
    })
  })
  it("is empty when only Competitors is on but there is no competitor data", () => {
    expect(listSections(false, true, false)).toEqual({
      listings: false, competitors: false, empty: true, collapsibleListings: false,
    })
  })
  it("still shows listings when both on but no competitor data", () => {
    expect(listSections(true, true, false)).toEqual({
      listings: true, competitors: false, empty: false, collapsibleListings: false,
    })
  })
})

describe("listSections collapsibleListings", () => {
  it("allows collapsing only when a competitor block is also rendering", () => {
    expect(listSections(true, true, true).collapsibleListings).toBe(true)
  })
  it("never collapses when the competitor layer is toggled off", () => {
    // Otherwise the page would open to a collapsed header and nothing else.
    expect(listSections(true, false, true).collapsibleListings).toBe(false)
  })
  it("never collapses when there is no competitor data at all", () => {
    expect(listSections(true, true, false).collapsibleListings).toBe(false)
  })
  it("never marks a non-rendering listings block collapsible", () => {
    expect(listSections(false, true, true).collapsibleListings).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/browse-list-sections.test.ts`
Expected: FAIL — every `toEqual` reports the missing `collapsibleListings` key, and `.collapsibleListings` is `undefined`.

- [ ] **Step 3: Extend the helper**

In `src/lib/browse-list-sections.ts`, add the field to the interface:

```ts
export interface ListSections {
  listings: boolean
  competitors: boolean
  empty: boolean
  /**
   * Whether the listings block may start collapsed. True ONLY when a
   * competitor block renders alongside it — collapsing the only visible block
   * would open the page to a header and nothing else.
   */
  collapsibleListings: boolean
}
```

and the derivation in the return:

```ts
  const listings = showListings
  const competitors = showCompetitors && hasCompetitors
  return {
    listings,
    competitors,
    empty: !listings && !competitors,
    collapsibleListings: listings && competitors,
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/browse-list-sections.test.ts && npx tsc --noEmit`
Expected: 10 tests PASS, tsc clean.

- [ ] **Step 5: Wire the collapse into the component**

In `src/components/browse/BrowseListContent.tsx`: add `useState` to the React import, then replace the listings block. Note `HEADING` already carries `mb-3`, so the button reuses it as-is.

```tsx
"use client"

import { useState } from "react"
```

Inside the component, after the existing `both` line:

```tsx
  const sections = listSections(showListings, showCompetitors, competitorClosures.length > 0)
  const both = sections.listings && sections.competitors
  // Collapsed on load so owners land on competitor closures. Deliberately NOT
  // in the URL or localStorage: it's a reading preference, not shareable state,
  // and a nuqs flag would ride along in every shared /browse link.
  const [listingsOpen, setListingsOpen] = useState(false)
  const listingsCollapsed = sections.collapsibleListings && !listingsOpen
```

Replace the `{sections.listings && ( … )}` block with:

```tsx
      {sections.listings && (
        <div>
          {both && (
            <button
              type="button"
              onClick={() => setListingsOpen((o) => !o)}
              aria-expanded={listingsOpen}
              aria-controls="hs-listings-panel"
              className={`${HEADING} flex w-full items-center gap-2 rounded-md text-left transition-colors hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2`}
            >
              <span>Hello Sugar listings</span>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-200 px-1.5 text-[11px] font-bold tabular-nums text-gray-700">
                {initialListings.length}
              </span>
              <svg
                className={`h-3.5 w-3.5 transition-transform ${listingsOpen ? "rotate-180" : ""}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
          {/* Kept MOUNTED and hidden rather than unmounted: ListingGrid fetches
             on mount, so unmounting would re-fetch on every expand. `hidden`
             also removes it from the accessibility tree. */}
          <div id="hs-listings-panel" hidden={listingsCollapsed}>
            <ListingGrid
              initialListings={initialListings}
              filters={filters}
              hoveredId={hoveredId}
              onHover={onHover}
              favoriteIds={favoriteIds}
              singleColumn={singleColumn}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 6: Type gate + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; suite green (no pre-existing failures introduced).

- [ ] **Step 7: Commit**

```bash
git add src/lib/browse-list-sections.ts src/__tests__/browse-list-sections.test.ts src/components/browse/BrowseListContent.tsx
git commit -m "feat(browse): collapse Hello Sugar listings by default

Owners open /browse for competitor closures, so the listings block now
starts collapsed behind a count badge on mobile and desktop.

Collapsing applies ONLY when a competitor block renders alongside it --
otherwise a user with the competitor layer off would open the page to a
collapsed header and nothing else. That rule lives in listSections() so
it is actually tested; the component can't render-test here (vitest runs
node-environment and collects .ts only).

The grid stays mounted behind \`hidden\` so expanding doesn't re-fetch."
```

---

## Task 3: Wire the map + legend to the marker rules

Delivers the icon swap and the stacking fix together — shipping the map without the legend would leave the on-map key lying about which mark means what.

**Files:**
- Modify: `src/components/browse/MapView.tsx`
- Modify: `src/components/browse/MapLegend.tsx`

**Interfaces:**
- Consumes: `MARKER_ICON`, `MarkerVariant`, `MarkerLayer`, `markerVariant`, `hsMarkerLayer`, `markerZIndex` from `@/lib/browse/map-markers` (Task 1).
- Produces: nothing new for later tasks. Task 6 edits the same competitor-marker code, so land this first.

- [ ] **Step 1: Replace the local icon tables in MapView**

Add the import:

```ts
import {
  MARKER_ICON,
  type MarkerVariant,
  type MarkerLayer,
  markerVariant,
  hsMarkerLayer,
  markerZIndex,
} from "@/lib/browse/map-markers"
```

Delete the local `MARKER_ICON` object and the `type MarkerVariant = keyof typeof MARKER_ICON` line (they now come from the module), and keep `MARKER_SHADOW` / `MARKER_SIZE` / `OWNER_BADGE_WIDTH` — but retarget the shadow table and the sizing branch at the renamed variants.

`MARKER_SHADOW` becomes:

```ts
// Drop-shadows tuned per variant so each mark seats legibly on the light street
// map. The unlisted white mark gets a tighter dark halo so it doesn't dissolve
// into pale tiles the way a plain white glyph would.
const MARKER_SHADOW: Record<MarkerVariant, string> = {
  forSale: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))",
  owned: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))",
  unlisted: "drop-shadow(0 0 1px rgba(0,0,0,0.55)) drop-shadow(0 1px 3px rgba(0,0,0,0.45))",
}
```

Rename the badge-width constant to match what it now marks, and fix the sizing branch inside `hsIconMarkerEl` — the wide wordmark is now the **for-sale** variant, so the branch must test `forSale`, not `owner`. Getting this backwards is the one way this task ships a visibly broken marker:

```ts
const MARKER_SIZE = 16
// The wordmark badge is wide, not a square glyph — render it wider so it stays
// legible while matching the swirls' visual weight (24 × ~15.6px).
const BADGE_WIDTH = 24

function hsIconMarkerEl(variant: MarkerVariant): HTMLDivElement {
  const el = document.createElement("div")
  const inner = document.createElement("img")
  inner.src = MARKER_ICON[variant]
  inner.alt = ""
  inner.draggable = false
  // The badge keeps its own aspect (height: auto) so border-radius clips the
  // actual red field instead of a letterboxed square.
  const size = variant === "forSale"
    ? `width: ${BADGE_WIDTH}px; height: auto; border-radius: 3px;`
    : `width: ${MARKER_SIZE}px; height: ${MARKER_SIZE}px; object-fit: contain;`
  inner.style.cssText = `
    display: block;
    ${size}
    cursor: pointer;
    transform-origin: center;
    filter: ${MARKER_SHADOW[variant]};
    transition: transform 0.15s ease;
  `
  el.appendChild(inner)
  return el
}
```

Also update the block comment above `MARKER_ICON`'s old location (the one reading `color → for-sale listing (swirl) …`) to describe the new mapping, or delete it — it now documents the opposite of the truth.

- [ ] **Step 2: Track each marker's stacking layer**

The hover effects need a marker's base band to reset to. Widen the listing marker ref (line ~253):

```ts
  const markers = useRef<{ marker: maptilersdk.Marker; id: string; layer: MarkerLayer }[]>([])
```

- [ ] **Step 3: Set variant + base z-index on listing markers**

In the listing marker effect, replace the `isMine` / `el` lines:

```ts
        const isMine = showMyLocations && ownedListingSet.has(listing.id)
        const layer = hsMarkerLayer("listing", isMine)

        const el = hsIconMarkerEl(markerVariant("listing", isMine))
        el.dataset.listingId = listing.id
        el.style.zIndex = markerZIndex(layer)
```

and the push at the end of the loop:

```ts
        markers.current.push({ marker, id: listing.id, layer })
```

- [ ] **Step 4: Reset listing hover to the base band, not ""**

Replace the `hoveredId` highlight effect body:

```ts
  // Highlight hovered marker. Note the non-hovered branch restores the marker's
  // BASE band — resetting zIndex to "" would drop it back to accidental DOM
  // order and silently undo the layer ordering.
  useEffect(() => {
    for (const { marker, id, layer } of markers.current) {
      const el = marker.getElement()
      const inner = el.firstElementChild as HTMLElement | null
      if (!inner) continue
      // Scale the inner element (MapTiler doesn't touch it); zIndex on the
      // outer element is safe (MapTiler doesn't set it).
      inner.style.transform = id === hoveredId ? "scale(1.3)" : "scale(1)"
      el.style.zIndex = markerZIndex(layer, id === hoveredId)
    }
  }, [hoveredId])
```

- [ ] **Step 5: Same for the unlisted-HS marker effect**

In the HS-location effect, replace the `isMine` / `el` lines:

```ts
        const isMine = showMyLocations && ownedHsSet.has(loc.id)

        const el = hsIconMarkerEl(markerVariant("hsLocation", isMine))
        el.dataset.hsLocationId = loc.id
        el.style.zIndex = markerZIndex(hsMarkerLayer("hsLocation", isMine))
        const inner = el.firstElementChild as HTMLElement
```

These markers have no `hoveredId` coordination (they aren't in the list), so they need no hovered band — their local `mouseenter` scale is enough and must not touch `zIndex`.

- [ ] **Step 6: Base + hover band on competitor markers**

In the competitor effect, after the marker is created, add the base band:

```ts
        el.style.zIndex = markerZIndex("competitor")
```

and in that effect's `mouseenter` / `mouseleave` handlers replace the hard-coded `"5"` / `""`:

```ts
        el.addEventListener("mouseenter", () => {
          inner.style.transform = "rotate(45deg) scale(1.25)"
          el.style.zIndex = markerZIndex("competitor", true)
          onHover(c.googlePlaceId)
        })
        el.addEventListener("mouseleave", () => {
          inner.style.transform = "rotate(45deg)"
          el.style.zIndex = markerZIndex("competitor")
          onHover(null)
        })
```

Then the competitor `hoveredId` effect — replace the `"6"` / `""` with bands (the `rotate(45deg)` stays for now; **Task 6 removes it**):

```ts
  useEffect(() => {
    for (const { marker, id } of competitorMarkers.current) {
      const el = marker.getElement()
      const inner = el.firstElementChild as HTMLElement | null
      if (!inner) continue
      inner.style.transform = id === hoveredId ? "rotate(45deg) scale(1.35)" : "rotate(45deg)"
      el.style.zIndex = markerZIndex("competitor", id === hoveredId)
    }
  }, [hoveredId])
```

- [ ] **Step 7: Swap the legend swatches**

In `src/components/browse/MapLegend.tsx`, import the shared table so the key can't drift:

```ts
import { MARKER_ICON } from "@/lib/browse/map-markers"
```

In `MapLayerRows`, swap the two swatches and source every path from `MARKER_ICON`:

```tsx
      <ToggleRow
        label="Your locations"
        active={filters.showMyLocations}
        onClick={() => setFilters({ showMyLocations: !filters.showMyLocations })}
        swatch={<IconSwatch src={MARKER_ICON.owned} />}
        titleOverride={filters.showMyLocations ? "Show your locations in the normal marks" : "Highlight your locations with the Hello Sugar swirl"}
      />
      <ToggleRow
        label="For sale"
        active={filters.showListings}
        onClick={() => setFilters({ showListings: !filters.showListings })}
        swatch={<BadgeSwatch src={MARKER_ICON.forSale} />}
      />
      <ToggleRow
        label="Hello Sugar (not listed)"
        active={filters.showHsLocations}
        onClick={() => setFilters({ showHsLocations: !filters.showHsLocations })}
        swatch={<IconSwatch src={MARKER_ICON.unlisted} halo />}
      />
```

Note the "Your locations" `titleOverride` copy changed — it said "badge", which is now the for-sale mark.

- [ ] **Step 8: Type gate + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green.

- [ ] **Step 9: Commit**

```bash
git add src/components/browse/MapView.tsx src/components/browse/MapLegend.tsx
git commit -m "feat(browse): swap for-sale/owned marks and stack layers explicitly

For-sale listings now render the Hello Sugar wordmark badge and owned
locations the red swirl -- the reverse of before.

No marker layer previously set a base z-index, so stacking fell out of
DOM insertion order and competitor closures rendered UNDER Hello Sugar
markers. Bands are now explicit (competitors 40 > for-sale 30 > owned 20
> unlisted 10) with hover lifting +5 inside the band, and hover-out
restores the base band instead of clearing zIndex.

Legend swatches now read MARKER_ICON directly so the key can't drift
from the map."
```

- [ ] **Step 10: Visual check (needs a running app — ASK FIRST)**

Do **not** start the dev server yourself. Ask the user to run `npm run dev`, then via the Playwright MCP at 390×844 and 1280×800 on `/browse?view=map` confirm:
- a competitor diamond overlapping a Hello Sugar marker draws **on top**
- for-sale markers show the wordmark badge; owned show the red swirl
- hovering a for-sale marker does not raise it over a competitor diamond
- legend swatches match the markers
- toggling "Your locations" off returns owned markers to their layer's mark

---

## Task 4: Closure recency helper

**Files:**
- Create: `src/lib/closure-recency.ts`
- Test: `src/__tests__/closure-recency.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `NEW_CLOSURE_WINDOW_DAYS: number`, `isNewClosure(closedAt: string | null, now: Date): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/closure-recency.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { NEW_CLOSURE_WINDOW_DAYS, isNewClosure } from "@/lib/closure-recency"

const NOW = new Date("2026-08-04T12:00:00.000Z")
const daysBefore = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString()

describe("NEW_CLOSURE_WINDOW_DAYS", () => {
  it("is the agreed 14-day window", () => {
    expect(NEW_CLOSURE_WINDOW_DAYS).toBe(14)
  })
})

describe("isNewClosure", () => {
  it("flags a closure detected today", () => {
    expect(isNewClosure(daysBefore(0), NOW)).toBe(true)
  })
  it("flags a closure just inside the window", () => {
    expect(isNewClosure(daysBefore(13.9), NOW)).toBe(true)
  })
  it("flags a closure exactly on the window boundary", () => {
    expect(isNewClosure(daysBefore(14), NOW)).toBe(true)
  })
  it("does not flag a closure just outside the window", () => {
    expect(isNewClosure(daysBefore(14.1), NOW)).toBe(false)
  })
  it("does not flag an old closure", () => {
    expect(isNewClosure(daysBefore(120), NOW)).toBe(false)
  })
  it("never flags a null closedAt", () => {
    // 22 of 79 production rows have no closed_at. We do not claim recency
    // we don't know.
    expect(isNewClosure(null, NOW)).toBe(false)
  })
  it("never flags an unparseable date, and does not throw", () => {
    expect(() => isNewClosure("not a date", NOW)).not.toThrow()
    expect(isNewClosure("not a date", NOW)).toBe(false)
  })
  it("never flags an empty string", () => {
    expect(isNewClosure("", NOW)).toBe(false)
  })
  it("still flags a slightly future timestamp (scraper clock skew)", () => {
    const skewed = new Date(NOW.getTime() + 30_000).toISOString()
    expect(isNewClosure(skewed, NOW)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/closure-recency.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/closure-recency"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/closure-recency.ts`:

```ts
/**
 * Recency of a competitor closure.
 *
 * `closedAt` is when the external competitor-monitor scraper FIRST DETECTED the
 * closure — NOT when the business actually closed. User-facing copy must say
 * "Detected", never "Closed on".
 *
 * Two accepted limitations, both properties of the scraper's data rather than
 * of this code (see the design doc's data check, 2026-08-04):
 *   - 22 of 79 production rows have a null `closedAt` and can never be flagged
 *     new. Correct by omission: we don't claim recency we don't know.
 *   - The scraper reconciles weekly/monthly, so newly-detected closures arrive
 *     in batches and badges appear in clumps rather than trickling in.
 *
 * Pure, and free of any `server-only` import, so the client list/map components
 * and vitest can both import it.
 */

/** A closure counts as "new" for this many days after it was first detected. */
export const NEW_CLOSURE_WINDOW_DAYS = 14

const MS_PER_DAY = 86_400_000

/**
 * True when `closedAt` parses and was detected within the last
 * NEW_CLOSURE_WINDOW_DAYS. `now` is injected so the boundary is testable
 * without faking the clock.
 *
 * A timestamp slightly in the future — clock skew between the Railway scraper
 * and this app — counts as new: badging a few seconds early is harmless, while
 * suppressing a genuinely new closure is the failure that matters.
 */
export function isNewClosure(closedAt: string | null, now: Date): boolean {
  if (!closedAt) return false
  const detected = Date.parse(closedAt)
  if (Number.isNaN(detected)) return false
  return now.getTime() - detected <= NEW_CLOSURE_WINDOW_DAYS * MS_PER_DAY
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/closure-recency.test.ts && npx tsc --noEmit`
Expected: 10 tests PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/closure-recency.ts src/__tests__/closure-recency.test.ts
git commit -m "feat(browse): 14-day new-closure recency helper

Pure isNewClosure(closedAt, now) with the window in one constant. \`now\`
is injected so the boundary is testable without faking the clock.

Null closedAt is never new (22 of 79 production rows lack it) and an
unparseable date returns false rather than throwing. A slightly-future
stamp still counts as new -- scraper clock skew shouldn't suppress a real
new closure."
```

---

## Task 5: NEW pill on closure list cards

**Files:**
- Modify: `src/lib/brand-colors.ts`
- Modify: `src/components/browse/CompetitorList.tsx`

**Interfaces:**
- Consumes: `isNewClosure` from `@/lib/closure-recency` (Task 4).
- Produces: `BRAND.gold` (`"#CE9E58"`), consumed by Task 6's map star.

- [ ] **Step 1: Add the gold token mirror**

`brand-colors.ts` mirrors `globals.css` tokens for code that hands colors to MapTiler/Recharts as strings. `--color-amber-400` already exists in `globals.css` (line ~347) — this only adds the mirror. Insert after the `warningLight` entry:

```ts
  /** --color-amber-400 — new-closure star; needs a white stroke on caramel */
  gold: '#CE9E58',
```

- [ ] **Step 2: Render the pill**

In `src/components/browse/CompetitorList.tsx`, add the import:

```ts
import { isNewClosure } from "@/lib/closure-recency"
```

Compute one clock reading per render. Put it after the existing `if (competitors.length === 0)` early return and before the main `return` — a single `now` keeps every card in the list consistent:

```ts
  // One reading per render so every card in the list agrees on "now".
  const now = new Date()
```

Inside the `.map`, next to the existing `permanent` / `isHovered` lines:

```ts
          const isNew = isNewClosure(c.closedAt, now)
```

Then, immediately **before** the existing `{c.isOpportunity && ( … )}` chip, add:

```tsx
                {isNew && (
                  <span className="mb-1 mr-1 inline-flex items-center gap-1 rounded-full bg-amber-700 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-white">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
                      <path d="M12 2l2.9 6.26L21.5 9l-4.75 4.64L18 21l-6-3.27L6 21l1.25-7.36L2.5 9l6.6-.74L12 2z" />
                    </svg>
                    New
                  </span>
                )}
```

Design notes for the reviewer:
- **Solid** `bg-amber-700` + white text, not the soft `bg-amber-100`/`text-amber-600` of the Opportunity chip — a second soft caramel chip would read as its sibling rather than as an alert. `#965F24` on white is ~5.4:1, passing AA for this 12px bold text.
- Placed before the Opportunity chip so a new opportunity shows **both**, and `mr-1` keeps them apart when they wrap onto one line.
- `amber-700` is brand caramel, not stock Tailwind amber — `globals.css` `@theme` remaps the whole palette. That is intentional; do not "correct" it.

- [ ] **Step 3: Type gate + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/brand-colors.ts src/components/browse/CompetitorList.tsx
git commit -m "feat(browse): NEW pill on closures detected in the last 14 days

Solid caramel pill with a star, placed before the Opportunity chip so a
new opportunity shows both. Solid rather than soft-filled on purpose: a
second pale caramel chip would read as the Opportunity chip's sibling
instead of as an alert. Adds the BRAND.gold mirror of --color-amber-400
for the map star that follows."
```

---

## Task 6: New-closure star + pulse on the map

The riskiest task — it re-nests the exact element hierarchy MapTiler's outer-transform constraint governs. Read the Global Constraints again before starting.

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/browse/MapView.tsx`
- Modify: `src/components/browse/MapLegend.tsx`

**Interfaces:**
- Consumes: `isNewClosure` (Task 4), `BRAND.gold` (Task 5), `markerZIndex` (Task 1).
- Produces: nothing.

- [ ] **Step 1: Add the pulse keyframe**

Append to `src/app/globals.css`, alongside the other unlayered utility classes (near `.pb-tabbar`):

```css
/* ====================================
   NEW-CLOSURE MARKER PULSE
   ==================================== */

/* Ring that breathes outward from a competitor closure detected in the last
   NEW_CLOSURE_WINDOW_DAYS (see src/lib/closure-recency.ts). Applied to a child
   of the marker's `inner` element, so it composes with inner's hover scale.
   Unlayered so it isn't stripped by Tailwind's layer ordering. */
@keyframes hs-new-closure-pulse {
  0% { transform: scale(0.85); opacity: 0.7; }
  70% { transform: scale(1.6); opacity: 0; }
  100% { transform: scale(1.6); opacity: 0; }
}

.hs-new-closure-pulse {
  animation: hs-new-closure-pulse 2s ease-out infinite;
}

/* Motion-sensitive users still get the marker flagged — a static ring plus the
   star glyph carry the meaning without the animation. */
@media (prefers-reduced-motion: reduce) {
  .hs-new-closure-pulse {
    animation: none;
    opacity: 0.65;
    transform: scale(1.15);
  }
}
```

- [ ] **Step 2: Restructure the competitor marker element**

In `src/components/browse/MapView.tsx`, add a new import (`BRAND` is already imported from `@/lib/brand-colors`; Task 5 added `gold` to it):

```ts
import { isNewClosure } from "@/lib/closure-recency"
```

Replace `competitorMarkerEl` entirely. The new nesting is:

```
outer    ← positioned by MapTiler; transform NEVER touched; carries z-index
└─ inner     ← position: relative; carries the hover SCALE only
   ├─ diamond   ← every existing visual + transform: rotate(45deg)
   ├─ star      ← absolute, UNROTATED (a sibling of diamond, not a child)
   └─ pulse     ← absolute ring, animated
```

```ts
// Content-box side of the diamond, per variant. Both variants use a 2px
// border that sits OUTSIDE this box (no box-sizing), so the rendered footprint
// is side + 4 — `inner` is sized to that footprint to keep the marker's overall
// size, and therefore MapTiler's centering, exactly as it was before the star
// was added.
const COMP_DIAMOND_SIDE = { opportunity: 11.3, plain: 12 } as const
const COMP_BORDER = 2

// Build the diamond marker element for a competitor closure. `isNew` adds the
// gold star + pulse ring for a recently detected closure.
function competitorMarkerEl(c: CompetitorClosure, isNew: boolean): HTMLDivElement {
  const el = document.createElement("div")
  el.dataset.competitorId = c.googlePlaceId

  const side = c.isOpportunity ? COMP_DIAMOND_SIDE.opportunity : COMP_DIAMOND_SIDE.plain
  const footprint = side + COMP_BORDER * 2

  // `inner` carries ONLY the hover scale. MapTiler rewrites the OUTER
  // element's transform every frame, so we must never touch that one.
  const inner = document.createElement("div")
  inner.style.cssText = `
    position: relative;
    width: ${footprint}px;
    height: ${footprint}px;
    transform-origin: center;
    transition: transform 0.15s ease;
  `

  // The 45° rotation lives HERE, not on `inner`, so the star can sit beside the
  // diamond without being tilted with it.
  const diamond = document.createElement("div")
  if (c.isOpportunity) {
    // 11.3px box → ~16px point-to-point once rotated 45° (16 / √2), matching
    // the 16px location marks. Halo trimmed to a 2px ring.
    diamond.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${side}px;
      height: ${side}px;
      background-color: ${COMP_OPP};
      border: ${COMP_BORDER}px solid white;
      border-radius: 3px;
      cursor: pointer;
      box-shadow: 0 0 0 2px ${COMP_OPP_HALO}, 0 2px 4px rgba(0,0,0,0.3);
      transform: rotate(45deg);
    `
  } else {
    diamond.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${side}px;
      height: ${side}px;
      background-color: white;
      border: ${COMP_BORDER}px solid ${COMP_MUTED};
      border-radius: 2px;
      cursor: pointer;
      opacity: 0.75;
      box-shadow: 0 1px 2px rgba(0,0,0,0.25);
      transform: rotate(45deg);
    `
  }
  inner.appendChild(diamond)

  if (isNew) {
    // Pulse first so it paints UNDER the star and diamond.
    const pulse = document.createElement("div")
    pulse.className = "hs-new-closure-pulse"
    pulse.style.cssText = `
      position: absolute;
      inset: -5px;
      border-radius: 999px;
      border: 2px solid ${BRAND.gold};
      pointer-events: none;
    `
    inner.appendChild(pulse)

    // Unrotated: a sibling of `diamond`, so it does not inherit rotate(45deg).
    // The white stroke is not decoration -- gold on the caramel opportunity
    // diamond is only ~1.5:1, so the outline is what makes the star readable
    // there and on pale map tiles alike.
    const star = document.createElement("div")
    star.style.cssText = `
      position: absolute;
      top: -7px;
      right: -8px;
      width: 11px;
      height: 11px;
      pointer-events: none;
      filter: drop-shadow(0 1px 1px rgba(0,0,0,0.35));
    `
    star.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="${BRAND.gold}" stroke="white" stroke-width="2.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l2.9 6.26L21.5 9l-4.75 4.64L18 21l-6-3.27L6 21l1.25-7.36L2.5 9l6.6-.74L12 2z"/></svg>`
    inner.appendChild(star)
  }

  el.appendChild(inner)
  return el
}
```

- [ ] **Step 3: Pass `isNew` at the call site**

In the competitor marker effect, add a single clock reading inside `apply()` (above the `for` loop) and pass it through:

```ts
      // One reading per rebuild so every marker agrees on "now".
      const now = new Date()

      for (const c of valid) {
        const el = competitorMarkerEl(c, isNewClosure(c.closedAt, now))
        const inner = el.firstElementChild as HTMLElement
```

`now` is a local, so the effect's dependency array is unchanged.

- [ ] **Step 4: Drop `rotate(45deg)` from all three transform write sites**

The rotation moved to `diamond`, so any `inner.style.transform` that still says `rotate(45deg)` will **double-rotate the whole marker back to a square**. All three must become plain `scale()`. Missing one is the regression this task is most likely to ship.

In the competitor `hoveredId` effect (edited in Task 3, Step 6):

```ts
      inner.style.transform = id === hoveredId ? "scale(1.35)" : "scale(1)"
```

In the marker's own `mouseenter` (edited in Task 3, Step 6):

```ts
          inner.style.transform = "scale(1.25)"
```

In the marker's own `mouseleave`:

```ts
          inner.style.transform = "scale(1)"
```

- [ ] **Step 5: Add the legend key row**

In `MapLegend.tsx`, import the window constant so the key's copy cannot drift from the rule:

```ts
import { NEW_CLOSURE_WINDOW_DAYS } from "@/lib/closure-recency"
```

Then add a star swatch next to the existing `Diamond` / `DiamondHollow` helpers:

```tsx
// Gold star matching the new-closure marker overlay. Key entry only.
function NewStar() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3 text-amber-700" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.9 6.26L21.5 9l-4.75 4.64L18 21l-6-3.27L6 21l1.25-7.36L2.5 9l6.6-.74L12 2z" />
    </svg>
  )
}
```

Then add a third row inside the competitor group in `MapLayerRows`, after the "Closed" row. It is a **key entry, not a toggle** — there is no `showNewClosures` filter flag and adding one is out of scope:

```tsx
        <div className={`flex items-center gap-2 py-0.5 pl-6 text-xs ${compActive ? "text-gray-500" : "text-gray-300"}`}>
          <NewStar />
          <span>New (last {NEW_CLOSURE_WINDOW_DAYS} days)</span>
        </div>
```

- [ ] **Step 6: Type gate + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/components/browse/MapView.tsx src/components/browse/MapLegend.tsx
git commit -m "feat(browse): star recently detected closures on the map

Competitor markers detected within 14 days gain a gold star and a
pulsing ring, additive to the existing opportunity/plain distinction so
no fourth marker colour is introduced.

Re-nests the marker DOM: the 45deg rotation moves from \`inner\` down to a
new \`diamond\` child so the star can sit beside it unrotated, and
\`inner\` now carries only the hover scale. All three sites that wrote
rotate(45deg) into inner.style.transform become plain scale() -- leaving
any one would double-rotate the marker back to a square. \`inner\` is
sized to the diamond's full footprint (side + 2x border) so MapTiler's
centering is unchanged.

The outer element's transform is still never touched."
```

- [ ] **Step 8: Visual check (needs a running app + seeded data — ASK FIRST)**

Only **1 of 79** production rows is currently inside the 14-day window, so a glance at real data will look like the feature is broken. Ask the user to start `npm run dev`, then verify:
- **Hover regression first:** hover a competitor diamond — it must scale, **not** rotate into a square, and must return cleanly on mouse-out. Do this on both an opportunity (caramel) and a plain (hollow) diamond.
- The one genuinely new closure shows the star + pulse; its list card shows the NEW pill.
- To see the treatment at scale, temporarily set `NEW_CLOSURE_WINDOW_DAYS` to `200` locally, confirm ~57 markers light up, then **revert to 14** before finishing. Never write to `competitor_opportunities`.
- Pan the map: starred markers stay glued to their coordinates (no drift to 0,0 — the outer-transform failure mode).
- Legend shows the "New (last 14 days)" row.

---

## Task 7: Mobile header and tab bar

**Files:**
- Modify: `src/components/layout/HeaderNav.tsx`
- Modify: `src/components/layout/MobileTabBar.tsx`
- Modify: `src/__tests__/navigation.test.ts`

**Interfaces:**
- Consumes: `MARKETPLACE_NAV` from `@/lib/navigation` (existing).
- Produces: `tabLabel(href: string, fallback: string): string` exported from `src/components/layout/MobileTabBar.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/navigation.test.ts`:

```ts
import { tabLabel } from "@/components/layout/MobileTabBar"
import { MARKETPLACE_NAV } from "@/lib/navigation"

describe("tabLabel", () => {
  it("shortens Brand Requests for the tab bar", () => {
    expect(tabLabel("/account/brand-requests", "Brand Requests")).toBe("Brands")
  })
  it("keeps the existing short labels", () => {
    expect(tabLabel("/account/alerts", "My Alerts")).toBe("Alerts")
    expect(tabLabel("/seller/listings", "My Listings")).toBe("Listings")
  })
  it("falls back to the nav label when there is no override", () => {
    expect(tabLabel("/browse", "Browse")).toBe("Browse")
  })
  it("resolves every marketplace tab to a single word", () => {
    // A two-word label wraps at five tabs on a 390px screen, which grows the
    // fixed bar past the 3.5rem .pb-tabbar reserves and pushes it up over the
    // map's floating controls.
    for (const item of MARKETPLACE_NAV) {
      expect(tabLabel(item.href, item.label)).not.toMatch(/\s/)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/navigation.test.ts`
Expected: FAIL — `tabLabel` is not exported from `MobileTabBar`.

- [ ] **Step 3: Add the short label and export the helper**

In `src/components/layout/MobileTabBar.tsx`, extend `TAB_LABELS` and export an accessor:

```ts
// Short labels for the tight tab layout; falls back to the nav label.
//
// Every marketplace tab MUST resolve to a single word here. A two-word label
// wraps at five tabs on a 390px screen, and because the bar is fixed to the
// bottom the extra height grows UPWARD over the content — covering the browse
// map's floating List pill and layers button. This map is tab-bar-only, so the
// desktop nav and the hamburger drawer keep the full "Brand Requests".
const TAB_LABELS: Record<string, string> = {
  "/account/alerts": "Alerts",
  "/account/brand-requests": "Brands",
  "/seller/listings": "Listings",
}

/** Tab-bar label for a nav href, falling back to the full nav label. */
export function tabLabel(href: string, fallback: string): string {
  return TAB_LABELS[href] ?? fallback
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/navigation.test.ts`
Expected: all PASS.

- [ ] **Step 5: Make the tab structurally wrap-proof**

Still in `MobileTabBar.tsx`, use the helper and stop any future label from growing the bar. `min-w-0` lets the column shrink and `truncate` clips inside it rather than forcing a second line:

```tsx
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[44px] min-w-0 flex-1 flex-col items-center gap-0.5 pt-1.5 pb-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-inset ${
                active ? "text-hs-red-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {TAB_ICONS[item.href] ?? TAB_ICONS["/browse"]}
              <span className="w-full truncate whitespace-nowrap text-center">
                {tabLabel(item.href, item.label)}
              </span>
            </Link>
```

- [ ] **Step 6: Hide the mobile logo on search pages**

In `src/components/layout/HeaderNav.tsx`, wrap the `<Logo>` in the top tier. Gate it on `mobileSearch` — the same conditional the bottom tier already uses — so only pages that hand the header a search slot (today just `/browse`) lose their mobile logo; account, seller, and admin pages keep theirs. Desktop is unchanged everywhere:

```tsx
        <div className="flex items-center justify-between h-14 gap-3">
          {/* Hidden on mobile only where a search slot claims the row (browse):
             the wide wordmark plus a full-width search field left the 44px
             hamburger visually colliding with the input. Austin approved
             dropping it to make room. Home stays reachable via the Browse tab. */}
          <div className={mobileSearch ? "hidden md:block" : "block"}>
            <Logo href={logoHref} />
          </div>
          {mobileSearch && <div className="flex-1 min-w-0 md:hidden">{mobileSearch}</div>}
```

The row's existing `gap-3` now supplies the clearance between the search field and the hamburger. Leave the rest of the tier alone.

- [ ] **Step 7: Type gate + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean, suite green.

- [ ] **Step 8: Commit**

```bash
git add src/components/layout/HeaderNav.tsx src/components/layout/MobileTabBar.tsx src/__tests__/navigation.test.ts
git commit -m "fix(browse): stop mobile header and tab bar collisions

Header: the Hello Sugar wordmark is hidden on mobile only where a search
slot claims the row (browse today), so the search field and the 44px
hamburger stop colliding. Other mobile pages and every desktop
breakpoint keep the logo.

Tab bar: 'Brand Requests' wrapped to two lines at five tabs on a 390px
screen, and because the bar is fixed to the bottom that extra height grew
UPWARD over the map's floating List pill and layers button. Short label
'Brands' (tab-bar-only -- desktop nav and drawer keep the full label),
plus whitespace-nowrap/truncate/min-w-0 so no future label can grow the
bar again. A test asserts every marketplace tab resolves to one word."
```

- [ ] **Step 9: Visual check (needs a running app — ASK FIRST)**

Ask the user to start `npm run dev`, then at 390×844 confirm on `/browse`:
- no logo in the red masthead; search spans the row; clear gap before the hamburger; the hamburger's full 44px is tappable
- five single-line, centered tab labels
- the bar sits at its reserved height and the floating **List** pill and **layers** button are both fully visible and tappable
- on `/account/favorites` (no search slot) the mobile logo is still present
- at 1280×800 the desktop masthead is unchanged and the nav still reads "Brand Requests"

---

## Final verification

- [ ] **Step 1: Full suite + type gate**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; vitest green. Record the actual pass/fail counts — do not claim green without the output.

- [ ] **Step 2: Confirm `npm run lint` is still only pre-existing failures**

Run: `npm run lint`
Lint is broken pre-existing. Compare against `git stash`-ed baseline output if anything looks new; do not "fix" unrelated lint.

- [ ] **Step 3: Production build (dev server must be stopped)**

Ask the user to stop `npm run dev` first — Windows holds a `.next` lock and the build will fail otherwise. Then run `npm run build`.

- [ ] **Step 4: Cross-cutting visual pass**

At 390×844 and 1280×800 with the app running, walk `/browse` in both `?view=list` and `?view=map` and confirm the six changes together: header, tab bar, collapsed listings with count badge, marker icons, competitor-on-top stacking, and the NEW pill/star. Capture screenshots for the PR.

- [ ] **Step 5: Open the PR against `origin/main`**

Scope the PR against `origin/main` (not local `main`). Include before/after mobile screenshots and state plainly that the close-date/last-seen card treatment was cut from scope pending the scraper's real `last_seen` column.

## Self-review notes

**Spec coverage:** Change 1 → Task 7 (Step 6). Change 2 → Task 7 (Steps 1–5). Change 3 → Task 2. Change 4 → Tasks 1 + 3. Change 5 → Tasks 1 + 3 (incl. legend). Change 6 → Tasks 4 + 5 + 6. Out-of-scope close-date treatment → deliberately absent, restated in the PR step. Spec's Testing section → per-task test steps plus Final verification; its "component render" suggestion is replaced by pure-helper extraction and flagged in Deviations. Spec's three Risks → the marker-DOM risk is Task 6 Steps 2/4 plus its hover-first visual check; the z-index reset risk is Task 3 Steps 4/6 and the `markerZIndex` doc comment; the invisible-on-real-data risk is Task 6 Step 8's temporary window widening.

**Ordering rationale:** pure modules before their consumers, so every consumer step has real signatures to call. Task 3 lands the competitor `hoveredId` edits *before* Task 6 re-nests the same markers, so the two tasks touch that code in a defined order rather than conflicting. Riskiest task (6) sits after everything it depends on and before only the independent Task 7.

**Naming consistency check:** `MarkerVariant` members (`forSale`/`owned`/`unlisted`) and `MarkerLayer` members (`competitor`/`forSale`/`owned`/`unlistedHs`) are deliberately different — a variant is an icon, a layer is a stacking band, and `unlisted` vs `unlistedHs` keeps them from being silently interchangeable. `hsMarkerLayer` and `markerVariant` share the `(kind, isMine)` signature. `BADGE_WIDTH` replaces `OWNER_BADGE_WIDTH` (Task 3, Step 1) and is referenced only there. `tabLabel` is used in Task 7 Steps 3, 5 and its test.
