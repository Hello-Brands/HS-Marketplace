# Header + Browse-Bar Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the global header to a red (#ED1845) masthead with the white Hello Sugar logo and high-contrast white buttons, give the browse search a long pink-trimmed oval that fills the dead space, and fold the Listings/Competitors list toggle into the Hello Sugar / Competitors pills.

**Architecture:** Pure presentation + small client-state change. Header chrome (`HeaderNav`, `WorldSwitcher`, `AccountMenu`, `Logo`) is restyled in place; the search oval is CSS + a width tweak in `FilterBar`; the list-content rule is extracted into a pure, unit-tested helper consumed by a new `BrowseListContent` component that replaces the two duplicated list-render spots in `BrowsePage`.

**Tech Stack:** Next.js 15 (App Router), React 18, TypeScript, Tailwind (arbitrary values like `bg-[#ED1845]`), nuqs, Vitest. Plain `<img>` for the logo (no next/image).

## Global Constraints

- **Header red = `#ED1845`** exactly, applied to BOTH tiers of `HeaderNav`. Use Tailwind arbitrary values (`bg-[#ED1845]`, `text-[#ED1845]`). This is the shared header → it also affects admin pages (intended).
- **Button treatment = Option A (solid white):** active/primary controls are solid white pills with `#ED1845` text; inactive controls are white text on red with `hover:bg-white/15`.
- **Logo:** `public/logo-horizontal-white.png` (copied from `C:\Users\Owner\Downloads\LOGO-Horizontal_White.png`), rendered top-left, **replacing** the wordmark — no "Sugar / Marketplace" text. Plain `<img className="h-8 w-auto">`.
- **Search trim = brand pink `#db2777`** (2px border + soft glow).
- **Pills behavior = list mirrors the pills:** the Hello Sugar / Competitors pills drive both the map (unchanged) and the left list.
- **Gates:** `npx tsc --noEmit` clean; Vitest stays green. No `npm run lint` (pre-existing broken), no `next build` (Windows .next lock), never start a dev server.
- Reuse existing components/patterns; don't restructure unrelated code or delete the old `public/hello-sugar-logo.svg`.

---

### Task 1: White logo asset + `Logo.tsx`

**Files:**
- Create: `public/logo-horizontal-white.png` (copied binary)
- Modify: `src/components/layout/Logo.tsx`

**Interfaces:**
- Produces: `<Logo href>` renders the white horizontal PNG at `h-8 w-auto`.

- [ ] **Step 1: Copy the asset**

Run: `cp "/c/Users/Owner/Downloads/LOGO-Horizontal_White.png" public/logo-horizontal-white.png`
Then verify: `ls -la public/logo-horizontal-white.png` (expect ~85KB file present).

- [ ] **Step 2: Swap the logo**

Replace the entire body of `src/components/layout/Logo.tsx` with:

```tsx
import Link from "next/link"

/**
 * Brand mark in the header — the white horizontal logo, shown on the red masthead.
 * Links to the current world's home.
 */
export function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center" aria-label="Hello Sugar Marketplace">
      <img src="/logo-horizontal-white.png" alt="Hello Sugar" className="h-8 w-auto" />
    </Link>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/logo-horizontal-white.png src/components/layout/Logo.tsx
git commit -m "feat(ui): white horizontal logo for the red header"
```

---

### Task 2: Red header + Option A buttons — `HeaderNav`, `WorldSwitcher`, `AccountMenu`

**Files:**
- Modify: `src/components/layout/HeaderNav.tsx` (lines 50, 59-67, 73-110)
- Modify: `src/components/layout/WorldSwitcher.tsx` (the returned JSX)
- Modify: `src/components/layout/AccountMenu.tsx:39` (avatar ring)

**Interfaces:**
- Consumes: `Logo` (Task 1).
- Produces: a red two-tier header with white logo, white nav text, solid-white active pills, a solid-white "+ Add Listing", and a red-styled Marketplace/Admin switcher.

- [ ] **Step 1: Recolor the `<header>` and top tier (HeaderNav.tsx)**

Change the header wrapper (line 50) from:

```tsx
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
```

to:

```tsx
    <header className="sticky top-0 z-40 bg-[#ED1845] text-white">
```

In the mobile hamburger button (lines 59-68), change `hover:bg-gray-100` → `hover:bg-white/15` and the inner `<svg>` class `text-gray-700` → `text-white`:

```tsx
          <button
            onClick={() => setOpen(true)}
            className="md:hidden flex items-center justify-center w-11 h-11 rounded-lg hover:bg-white/15"
            aria-label="Open menu"
            aria-expanded={open}
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
```

- [ ] **Step 2: Recolor the bottom tier (HeaderNav.tsx, lines 73-83)**

Change:

```tsx
      <div className="border-t border-gray-100 bg-gray-50/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 h-12">
            <div className="min-w-0">
              {title && (
                <h1 className="text-base font-semibold text-gray-900 truncate leading-tight">
                  {title}
                </h1>
              )}
              {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
            </div>
```

to:

```tsx
      <div className="border-t border-white/15">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 h-12">
            <div className="min-w-0">
              {title && (
                <h1 className="text-base font-semibold text-white truncate leading-tight">
                  {title}
                </h1>
              )}
              {subtitle && <p className="text-xs text-white/80 truncate">{subtitle}</p>}
            </div>
```

- [ ] **Step 3: Restyle the nav links + primary action (HeaderNav.tsx, lines 84-109)**

Replace the desktop `<nav>` block (the `items.map(...)` Link and the `action` Link) with:

```tsx
            <nav className="hidden md:flex items-center gap-1">
              {items.map((item) => {
                const active = isActive(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`text-sm px-3 py-1.5 rounded-full transition-colors ${
                      active
                        ? "bg-white text-[#ED1845] font-semibold shadow-sm"
                        : "text-white/90 hover:bg-white/15"
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
              {action && (
                <Link
                  href={action.href}
                  className="ml-1 text-sm font-bold text-[#ED1845] bg-white hover:bg-white/90 px-3.5 py-1.5 rounded-full shadow-md transition-colors"
                >
                  {action.label}
                </Link>
              )}
            </nav>
```

- [ ] **Step 4: Restyle WorldSwitcher for red (WorldSwitcher.tsx)**

Replace the returned JSX (the `<div role="group">…</div>`) with:

```tsx
  return (
    <div
      role="group"
      aria-label="Switch between Marketplace and Admin"
      className="inline-flex p-0.5 rounded-lg bg-white/18"
    >
      <Link
        href="/browse"
        aria-current={!isAdmin ? "page" : undefined}
        className={`${base} ${
          !isAdmin ? "bg-white text-[#ED1845] shadow-sm" : "text-white hover:bg-white/10"
        }`}
      >
        Marketplace
      </Link>
      <Link
        href="/admin"
        aria-current={isAdmin ? "page" : undefined}
        className={`${base} ${
          isAdmin ? "bg-white text-[#ED1845] shadow-sm" : "text-white hover:bg-white/10"
        }`}
      >
        Admin
      </Link>
    </div>
  )
```

(Keep the `const base = "text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"` line and the `isAdmin` const above it unchanged.)

- [ ] **Step 5: Give the account avatar a white ring (AccountMenu.tsx:39)**

Change the trigger button className from:

```tsx
        className="w-9 h-9 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center hover:opacity-90 transition"
```

to:

```tsx
        className="w-9 h-9 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center hover:opacity-90 transition ring-2 ring-white/70"
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/HeaderNav.tsx src/components/layout/WorldSwitcher.tsx src/components/layout/AccountMenu.tsx
git commit -m "feat(ui): red header masthead with solid-white nav buttons (Option A)"
```

---

### Task 3: Long pink search oval + remove the dead gap — `globals.css`, `FilterBar.tsx`

**Files:**
- Modify: `src/app/globals.css` (the `.hs-geocoder--lg input` rule)
- Modify: `src/components/browse/FilterBar.tsx` (prominent search wrapper + divider)

**Interfaces:**
- Consumes: the `hs-geocoder--lg` class already applied by `LocationSearch variant="prominent"`.
- Produces: a full-width (capped) pink-trimmed oval search with no empty gap before the filter pills.

- [ ] **Step 1: Add the pink trim + glow (globals.css)**

Find the `.hs-geocoder--lg input` rule and replace it with:

```css
/* Prominent variant used in the top filter bar */
.hs-geocoder--lg input {
  height: 52px;
  border-radius: 9999px;
  font-size: 0.95rem;
  border: 2px solid #db2777;
  box-shadow: 0 1px 3px rgba(219, 39, 119, 0.12);
}
```

- [ ] **Step 2: Make the search grow and remove the divider (FilterBar.tsx)**

Find this block (the prominent search wrapper followed by the divider):

```tsx
          {/* Prominent geographic search (desktop bar; mobile uses the second-row copy) */}
          <div className="hidden md:block w-[320px] lg:w-[360px]">
            <LocationSearch onSelect={onLocationSelect} variant="prominent" />
          </div>

          <div className="hidden md:block h-7 w-px bg-gray-200" />
```

Replace it with (wider growing wrapper, divider removed):

```tsx
          {/* Prominent geographic search (desktop bar; mobile uses the second-row copy) */}
          <div className="hidden md:block flex-1 max-w-[520px]">
            <LocationSearch onSelect={onLocationSelect} variant="prominent" />
          </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/components/browse/FilterBar.tsx
git commit -m "feat(browse): long pink-trimmed search oval, remove dead gap"
```

---

### Task 4: `listSections` pure helper (TDD)

**Files:**
- Create: `src/lib/browse-list-sections.ts`
- Test: `src/__tests__/browse-list-sections.test.ts`

**Interfaces:**
- Produces: `listSections(showListings: boolean, showCompetitors: boolean, hasCompetitors: boolean): { listings: boolean; competitors: boolean; empty: boolean }` and the exported `ListSections` interface. The competitor block is gated on there being competitor data; `empty` is true when neither block will render.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/browse-list-sections.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { listSections } from "@/lib/browse-list-sections"

describe("listSections", () => {
  it("shows both blocks when both layers on and competitors exist", () => {
    expect(listSections(true, true, true)).toEqual({ listings: true, competitors: true, empty: false })
  })
  it("shows only listings when only Hello Sugar is on", () => {
    expect(listSections(true, false, true)).toEqual({ listings: true, competitors: false, empty: false })
  })
  it("shows only competitors when only Competitors is on and data exists", () => {
    expect(listSections(false, true, true)).toEqual({ listings: false, competitors: true, empty: false })
  })
  it("is empty when neither layer is on", () => {
    expect(listSections(false, false, true)).toEqual({ listings: false, competitors: false, empty: true })
  })
  it("is empty when only Competitors is on but there is no competitor data", () => {
    expect(listSections(false, true, false)).toEqual({ listings: false, competitors: false, empty: true })
  })
  it("still shows listings when both on but no competitor data", () => {
    expect(listSections(true, true, false)).toEqual({ listings: true, competitors: false, empty: false })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/browse-list-sections.test.ts`
Expected: FAIL — module `@/lib/browse-list-sections` not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/browse-list-sections.ts`:

```ts
export interface ListSections {
  listings: boolean
  competitors: boolean
  empty: boolean
}

/**
 * Which blocks the browse list should render, derived from the Hello Sugar /
 * Competitors layer toggles. The competitor block also requires competitor data
 * to exist. `empty` is true when neither block will render.
 */
export function listSections(
  showListings: boolean,
  showCompetitors: boolean,
  hasCompetitors: boolean
): ListSections {
  const listings = showListings
  const competitors = showCompetitors && hasCompetitors
  return { listings, competitors, empty: !listings && !competitors }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/__tests__/browse-list-sections.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/browse-list-sections.ts src/__tests__/browse-list-sections.test.ts
git commit -m "feat(browse): listSections helper for pill-driven list content"
```

---

### Task 5: `BrowseListContent` + fold the toggle into the pills — `BrowsePage.tsx`

**Files:**
- Create: `src/components/browse/BrowseListContent.tsx`
- Modify: `src/components/browse/BrowsePage.tsx` (remove `listMode` + segmented toggle; render `BrowseListContent` in both list and map views; drop now-unused imports)

**Interfaces:**
- Consumes: `listSections` (Task 4); existing `ListingGrid`, `CompetitorList`; `ListingCard`/`ListingFilters` from `@/lib/listings-query`; `CompetitorClosure` from `@/lib/competitor-query`.
- Produces: `<BrowseListContent>` rendering the listings and/or competitors blocks (with headings only when both show) or an empty state, used in both the full list view and the map-view left panel.

- [ ] **Step 1: Create the `BrowseListContent` component**

Create `src/components/browse/BrowseListContent.tsx`:

```tsx
"use client"

import { ListingGrid } from "./ListingGrid"
import { CompetitorList } from "./CompetitorList"
import { listSections } from "@/lib/browse-list-sections"
import type { ListingCard, ListingFilters } from "@/lib/listings-query"
import type { CompetitorClosure } from "@/lib/competitor-query"

interface BrowseListContentProps {
  showListings: boolean
  showCompetitors: boolean
  initialListings: ListingCard[]
  filters: ListingFilters
  favoriteIds: string[]
  competitorClosures: CompetitorClosure[]
  savedSet: Set<string>
  onToggleSaveCompetitor: (c: CompetitorClosure) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
  singleColumn?: boolean
}

const HEADING = "text-xs font-bold uppercase tracking-wider text-gray-400 mb-3"

export function BrowseListContent({
  showListings,
  showCompetitors,
  initialListings,
  filters,
  favoriteIds,
  competitorClosures,
  savedSet,
  onToggleSaveCompetitor,
  hoveredId,
  onHover,
  singleColumn = false,
}: BrowseListContentProps) {
  const sections = listSections(showListings, showCompetitors, competitorClosures.length > 0)
  const both = sections.listings && sections.competitors

  if (sections.empty) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        No results to show. Toggle <span className="font-semibold">Hello Sugar</span> or{" "}
        <span className="font-semibold">Competitors</span> above.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {sections.listings && (
        <div>
          {both && <h2 className={HEADING}>Hello Sugar listings</h2>}
          <ListingGrid
            initialListings={initialListings}
            filters={filters}
            hoveredId={hoveredId}
            onHover={onHover}
            favoriteIds={favoriteIds}
            singleColumn={singleColumn}
          />
        </div>
      )}
      {sections.competitors && (
        <div>
          {both && <h2 className={HEADING}>Competitors</h2>}
          <CompetitorList
            competitors={competitorClosures}
            savedSet={savedSet}
            onToggleSave={onToggleSaveCompetitor}
            hoveredId={hoveredId}
            onHover={onHover}
          />
        </div>
      )}
    </div>
  )
}
```

(Note: `ListingGrid` already accepts both `favoriteIds` and `singleColumn` — they are used separately in the current `BrowsePage`. Passing both here is valid.)

- [ ] **Step 2: Update imports in `BrowsePage.tsx`**

Change the import on line 5-8 region: replace the direct `ListingGrid`/`CompetitorList` imports with the new component. Specifically remove:

```tsx
import { ListingGrid } from "./ListingGrid"
import { CompetitorList } from "./CompetitorList"
```

and add:

```tsx
import { BrowseListContent } from "./BrowseListContent"
```

- [ ] **Step 3: Remove the `listMode` state (BrowsePage.tsx:48-49)**

Delete these two lines:

```tsx
  // Which dataset the LEFT LIST shows. The map always shows both layers.
  const [listMode, setListMode] = useState<"listings" | "competitors">("listings")
```

- [ ] **Step 4: Remove the segmented Listings/Competitors toggle (BrowsePage.tsx:239-263)**

Delete the entire block:

```tsx
          {/* List dataset switch — only meaningful when the scraper has pushed
              at least one closure. Controls the LEFT LIST only; the map always
              shows both layers. */}
          {competitorClosures.length > 0 && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              <button
                onClick={() => setListMode("listings")}
                aria-pressed={listMode === "listings"}
                className={`px-4 py-2 text-sm font-semibold transition-all duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  ${listMode === "listings" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                Listings
              </button>
              <button
                onClick={() => setListMode("competitors")}
                aria-pressed={listMode === "competitors"}
                className={`px-4 py-2 text-sm font-semibold transition-all duration-200 border-l border-gray-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  ${listMode === "competitors" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                Competitors
              </button>
            </div>
          )}
```

- [ ] **Step 5: Replace the list-view render spot (BrowsePage.tsx:341-361)**

Replace:

```tsx
        {viewMode === "list" ? (
          /* List view — full width grid */
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {listMode === "competitors" ? (
              <CompetitorList
                competitors={competitorClosures}
                savedSet={savedSet}
                onToggleSave={handleToggleSaveCompetitor}
                hoveredId={hoveredId}
                onHover={setHoveredId}
              />
            ) : (
              <ListingGrid
                initialListings={initialListings}
                filters={filters}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                favoriteIds={favoriteIds}
              />
            )}
          </div>
        ) : (
```

with:

```tsx
        {viewMode === "list" ? (
          /* List view — full width */
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <BrowseListContent
              showListings={showListings}
              showCompetitors={showCompetitors}
              initialListings={initialListings}
              filters={filters}
              favoriteIds={favoriteIds}
              competitorClosures={competitorClosures}
              savedSet={savedSet}
              onToggleSaveCompetitor={handleToggleSaveCompetitor}
              hoveredId={hoveredId}
              onHover={setHoveredId}
            />
          </div>
        ) : (
```

- [ ] **Step 6: Replace the map-view left panel render spot (BrowsePage.tsx:367-387)**

Replace:

```tsx
            <div className="hidden md:block md:w-1/3 overflow-y-auto border-r border-gray-200 bg-white">
              <div className="px-4 py-4">
                {listMode === "competitors" ? (
                  <CompetitorList
                    competitors={competitorClosures}
                    savedSet={savedSet}
                    onToggleSave={handleToggleSaveCompetitor}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                  />
                ) : (
                  <ListingGrid
                    initialListings={initialListings}
                    filters={filters}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                    singleColumn
                  />
                )}
              </div>
            </div>
```

with:

```tsx
            <div className="hidden md:block md:w-1/3 overflow-y-auto border-r border-gray-200 bg-white">
              <div className="px-4 py-4">
                <BrowseListContent
                  showListings={showListings}
                  showCompetitors={showCompetitors}
                  initialListings={initialListings}
                  filters={filters}
                  favoriteIds={favoriteIds}
                  competitorClosures={competitorClosures}
                  savedSet={savedSet}
                  onToggleSaveCompetitor={handleToggleSaveCompetitor}
                  hoveredId={hoveredId}
                  onHover={setHoveredId}
                  singleColumn
                />
              </div>
            </div>
```

- [ ] **Step 7: Type-check (watch for unused vars)**

Run: `npx tsc --noEmit`
Expected: no errors. If tsc flags `opportunityCount` or any symbol as unused, that is pre-existing and outside this task — do not change it unless tsc errors specifically on YOUR removed `listMode`/imports (it should not, since they were fully removed).

- [ ] **Step 8: Run the helper test + full suite**

Run: `npx vitest run src/__tests__/browse-list-sections.test.ts` (expected: PASS).
Run: `npm test` (expected: full suite green).

- [ ] **Step 9: Commit**

```bash
git add src/components/browse/BrowseListContent.tsx src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): pills drive the list; remove Listings/Competitors toggle"
```

---

## Self-review notes (addressed)

- **Spec coverage:** (1) red header both tiers → Task 2; (2) Option A buttons → Task 2; (3) white logo replacing wordmark → Task 1; (4) long pink search oval → Task 3; (5) remove dead gap → Task 3; (6) remove Listings/Competitors toggle + list mirrors pills → Tasks 4-5; WorldSwitcher/AccountMenu on red → Task 2.
- **Shared header:** the red applies to admin pages too (Global Constraints) — intended.
- **Type consistency:** `listSections(showListings, showCompetitors, hasCompetitors)` and `ListSections { listings, competitors, empty }` are defined in Task 4 and consumed verbatim in Task 5's `BrowseListContent`.
- **DRY:** the two previously-duplicated list-render spots collapse into one `BrowseListContent`.
