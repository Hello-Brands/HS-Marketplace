# Mobile Browse Zillow-Style Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the mobile (`< md`) browse experience to Zillow's mobile-web patterns — 2-row compact header, bottom tab bar, floating List/Map pills, layers bottom sheet, full-screen filter sheet, favorites hearts — with desktop rendering unchanged.

**Architecture:** All mobile/desktop divergence stays at the existing `md` Tailwind breakpoint inside the existing components (no separate route trees). The URL (nuqs) is the communication bus: view mode joins filters as a URL param so the header search, floating pills, and BrowsePage stay in sync without prop drilling across the server/client boundary. New overlay primitives (`BottomSheet`, `FullScreenSheet`) and a counted scroll lock replace the two ad-hoc overlay mechanisms.

**Tech Stack:** Next.js 15 App Router, React 18, Tailwind v4 (`@theme` in `src/app/globals.css`), nuqs for URL state, MapTiler SDK, Drizzle/Neon, vitest (node environment).

**Spec:** `docs/superpowers/specs/2026-07-23-mobile-browse-zillow-overhaul-design.md`

## Global Constraints

- **Desktop untouched:** everything ≥ `md` (768px) must render pixel-identical after every task (exception: the favorites heart, which is approved to appear on desktop cards too).
- **No new dependencies.** No Radix/shadcn/headless-ui — overlays are hand-rolled to match repo conventions.
- **Vitest runs in `environment: "node"`** and only includes `src/__tests__/**/*.test.ts` (`.ts`, not `.tsx`). Unit tests are for pure logic modules only; React components gate on `npx tsc --noEmit`.
- **Never run `next build` while the dev server may be running** (Windows `.next` lock). Per-task gate is `npx tsc --noEmit`. Lint is broken pre-existing — do not try to fix it.
- **Do not start `npm run dev`** — visual verification happens at the end, only with user approval.
- **Brand tokens only:** colors via existing Tailwind classes (`hs-red-600`, `gray-*`, etc. — all remapped to brand in globals.css; emerald/sky/purple classes are intentional brand remaps, don't "fix" them).
- Touch targets ≥ 44px (`min-h-[44px]` / `w-11 h-11`), the repo's existing baseline.
- Commit after every task with a conventional-commit message. Git pushes use the `sugarparker` account.

## File Structure (created / modified)

```
Create:
  src/lib/scroll-lock.ts               counted body-scroll lock (pure, testable)
  src/hooks/useScrollLock.ts           React binding for scroll-lock
  src/lib/view-mode.ts                 shared nuqs parser for ?view=
  src/lib/tab-bar.ts                   pure tab-bar visibility rule
  src/lib/filter-count.ts              pure active-filter counter
  src/components/ui/Sheet.tsx          BottomSheet + FullScreenSheet primitives
  src/components/layout/MobileTabBar.tsx
  src/components/browse/BrowseHeaderSearch.tsx
  src/components/browse/FloatingViewToggle.tsx
  src/components/browse/MobileMapLayers.tsx
  src/components/browse/FavoriteHeart.tsx
  src/components/browse/MobileFilterSheet.tsx
  src/__tests__/scroll-lock.test.ts
  src/__tests__/tab-bar.test.ts
  src/__tests__/filter-count.test.ts
Modify:
  src/app/globals.css                  pb-tabbar utility, sheetup keyframe, compass hide; remove .drawer-open
  src/components/layout/HeaderNav.tsx  useScrollLock; mobileSearch slot; hide context tier on mobile
  src/components/layout/SiteHeader.tsx mobileSearch pass-through; render MobileTabBar
  src/app/browse/page.tsx              favorites fetch; mobileSearch prop
  src/components/browse/BrowsePage.tsx view-mode URL; mobile pill row; floating pills; sheets
  src/components/browse/FilterBar.tsx  export panels/constants for reuse
  src/components/browse/MapLegend.tsx  extract exported MapLayerRows
  src/components/browse/ListingCard.tsx  heart overlay
  src/components/browse/ListingGrid.tsx  favoriteIds → per-card favorited
  src/lib/favorites-actions.ts         getFavoriteListingIds()
  src/components/ui/index.ts           export sheets
  src/app/account/favorites/page.tsx   pb-tabbar clearance
  src/app/account/alerts/page.tsx      pb-tabbar clearance
  src/app/seller/listings/page.tsx     pb-tabbar clearance
Delete:
  src/components/browse/MobileFilterDrawer.tsx  (Task 10)
```

---

### Task 1: Counted scroll lock + HeaderNav migration

**Files:**
- Create: `src/lib/scroll-lock.ts`
- Create: `src/hooks/useScrollLock.ts`
- Test: `src/__tests__/scroll-lock.test.ts`
- Modify: `src/components/layout/HeaderNav.tsx` (drawer effect, lines 35–47)
- Modify: `src/app/globals.css` (remove `.drawer-open` rule, lines 475–478)

**Interfaces:**
- Produces: `acquireScrollLock(target?: ScrollLockTarget): void`, `releaseScrollLock(target?: ScrollLockTarget): void`, `_resetScrollLockForTests(): void` from `@/lib/scroll-lock`; `useScrollLock(active: boolean): void` from `@/hooks/useScrollLock`. Tasks 2 and 10 consume `useScrollLock`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/scroll-lock.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { acquireScrollLock, releaseScrollLock, _resetScrollLockForTests } from "@/lib/scroll-lock"

function fakeBody() {
  return { style: { overflow: "" } }
}

describe("scroll-lock", () => {
  beforeEach(() => _resetScrollLockForTests())

  it("locks on first acquire and unlocks on last release", () => {
    const body = fakeBody()
    acquireScrollLock(body)
    expect(body.style.overflow).toBe("hidden")
    releaseScrollLock(body)
    expect(body.style.overflow).toBe("")
  })

  it("stays locked while any holder remains (nested overlays)", () => {
    const body = fakeBody()
    acquireScrollLock(body) // e.g. filter sheet
    acquireScrollLock(body) // e.g. nested sort sheet
    releaseScrollLock(body)
    expect(body.style.overflow).toBe("hidden")
    releaseScrollLock(body)
    expect(body.style.overflow).toBe("")
  })

  it("ignores extra releases", () => {
    const body = fakeBody()
    releaseScrollLock(body)
    expect(body.style.overflow).toBe("")
    acquireScrollLock(body)
    expect(body.style.overflow).toBe("hidden")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/scroll-lock.test.ts`
Expected: FAIL — cannot resolve `@/lib/scroll-lock`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/scroll-lock.ts
// Counted body-scroll lock shared by every overlay (nav drawer, filter sheet,
// bottom sheets). Counting means a nested overlay closing can't unlock the
// body out from under the overlay that's still open — the bug risk with the
// previous two ad-hoc mechanisms (body.drawer-open class vs inline style).

export type ScrollLockTarget = { style: { overflow: string } }

let holders = 0

export function acquireScrollLock(target?: ScrollLockTarget): void {
  const t = target ?? document.body
  holders++
  if (holders === 1) t.style.overflow = "hidden"
}

export function releaseScrollLock(target?: ScrollLockTarget): void {
  const t = target ?? document.body
  holders = Math.max(0, holders - 1)
  if (holders === 0) t.style.overflow = ""
}

/** Test-only: reset the holder count between cases. */
export function _resetScrollLockForTests(): void {
  holders = 0
}
```

```ts
// src/hooks/useScrollLock.ts
"use client"

import { useEffect } from "react"
import { acquireScrollLock, releaseScrollLock } from "@/lib/scroll-lock"

/** Locks body scroll while `active` is true. Safe to nest across overlays. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    acquireScrollLock()
    return () => releaseScrollLock()
  }, [active])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/scroll-lock.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Migrate HeaderNav's drawer to the hook**

In `src/components/layout/HeaderNav.tsx`, add imports and replace the drawer effect (currently lines 35–47):

```tsx
import { useScrollLock } from "@/hooks/useScrollLock"
```

```tsx
  useScrollLock(open)

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    if (open) document.addEventListener("keydown", onEsc)
    return () => document.removeEventListener("keydown", onEsc)
  }, [open])
```

(Removes both `document.body.classList.add/remove("drawer-open")` calls.)

In `src/app/globals.css`, delete the now-dead rule (lines 475–478):

```css
/* Lock background scroll while the mobile nav drawer is open (HeaderNav). */
body.drawer-open {
  overflow: hidden;
}
```

- [ ] **Step 6: Typecheck and full test run**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npx vitest run` — expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/scroll-lock.ts src/hooks/useScrollLock.ts src/__tests__/scroll-lock.test.ts src/components/layout/HeaderNav.tsx src/app/globals.css
git commit -m "refactor: unify overlay scroll locking behind counted useScrollLock"
```

---

### Task 2: BottomSheet + FullScreenSheet primitives

**Files:**
- Create: `src/components/ui/Sheet.tsx`
- Modify: `src/components/ui/index.ts`
- Modify: `src/app/globals.css` (add `sheetup` keyframe)

**Interfaces:**
- Consumes: `useScrollLock(active)` from Task 1.
- Produces:
  - `BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode })`
  - `FullScreenSheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode })`
  - Both exported from `@/components/ui`. Tasks 7, 8, 10 consume them. Both are `md:hidden` (mobile-only by design).

- [ ] **Step 1: Add the slide-up keyframe to globals.css**

Next to the existing keyframes (search for `@keyframes` — the `filterpop` animation is the pattern to sit beside), add:

```css
/* Slide-up entrance for mobile sheets (BottomSheet / FullScreenSheet). */
@keyframes sheetup {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
```

- [ ] **Step 2: Write the component**

```tsx
// src/components/ui/Sheet.tsx
"use client"

import { useEffect } from "react"
import { useScrollLock } from "@/hooks/useScrollLock"

// Mobile-only overlay primitives (md:hidden). Hand-rolled — no Radix in this
// repo. Escape / backdrop-tap close; body scroll locks via the shared counted
// lock so nested sheets can't unlock each other. Close is never blocked on
// content — the X and backdrop always work.

interface SheetBaseProps {
  open: boolean
  onClose: () => void
  /** Accessible dialog name, shown in the sheet header. */
  title: string
  children: React.ReactNode
}

function useSheetEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onEsc)
    return () => document.removeEventListener("keydown", onEsc)
  }, [open, onClose])
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <button
        onClick={onClose}
        aria-label={`Close ${title.toLowerCase()}`}
        className="flex items-center justify-center w-11 h-11 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

/** Partial-height sheet sliding up from the bottom (layer toggles, sort). */
export function BottomSheet({ open, onClose, title, children }: SheetBaseProps) {
  useScrollLock(open)
  useSheetEscape(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-x-0 bottom-0 flex max-h-[70dvh] flex-col rounded-t-2xl bg-white shadow-xl animate-[sheetup_0.2s_ease-out]"
      >
        <SheetHeader title={title} onClose={onClose} />
        <div className="overflow-y-auto px-4 py-3 pb-safe-lg">{children}</div>
      </div>
    </div>
  )
}

interface FullScreenSheetProps extends SheetBaseProps {
  /** Sticky footer (e.g. "Show results" + "Clear all"). Sits above the safe area. */
  footer?: React.ReactNode
}

/** Full-viewport sheet sliding up (mobile filters). */
export function FullScreenSheet({ open, onClose, title, children, footer }: FullScreenSheetProps) {
  useScrollLock(open)
  useSheetEscape(open, onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute inset-0 flex flex-col bg-white animate-[sheetup_0.2s_ease-out]"
      >
        <SheetHeader title={title} onClose={onClose} />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-gray-200 px-4 pt-3 pb-safe-lg bg-white">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Export from the ui barrel**

In `src/components/ui/index.ts` add:

```ts
export { BottomSheet, FullScreenSheet } from './Sheet'
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Sheet.tsx src/components/ui/index.ts src/app/globals.css
git commit -m "feat(ui): BottomSheet and FullScreenSheet mobile overlay primitives"
```

---

### Task 3: View mode in the URL

**Files:**
- Create: `src/lib/view-mode.ts`
- Modify: `src/components/browse/BrowsePage.tsx` (line 50 + the three `setViewMode` call sites, lines 113, 157, and toggle buttons 220/240)

**Interfaces:**
- Produces: `VIEW_MODES`, `type ViewMode = "list" | "map"`, `viewModeParser` from `@/lib/view-mode`. Tasks 5 and 7 consume `viewModeParser`.
- BrowsePage behavior contract: `viewMode` reads/writes the `?view=` URL param (default `"map"`, shallow, history replace — nuqs defaults).

- [ ] **Step 1: Create the shared parser**

```ts
// src/lib/view-mode.ts
import { parseAsStringLiteral } from "nuqs"

// Browse list/map view, shared by BrowsePage, the header search, and the
// floating toggle so they coordinate through the URL instead of prop drilling
// across the server/client boundary. Default matches the old useState default.
export const VIEW_MODES = ["list", "map"] as const
export type ViewMode = (typeof VIEW_MODES)[number]
export const viewModeParser = parseAsStringLiteral(VIEW_MODES).withDefault("map")
```

- [ ] **Step 2: Swap BrowsePage's local state for the URL param**

In `src/components/browse/BrowsePage.tsx`:

```tsx
import { useQueryState } from "nuqs"
import { viewModeParser } from "@/lib/view-mode"
```

Replace line 50:

```tsx
  const [viewMode, setViewMode] = useState<"list" | "map">("map")
```

with:

```tsx
  // View mode lives in the URL (?view=list|map) so it survives reload/share
  // and other components (header search, floating toggle) can flip it.
  const [viewMode, setViewMode] = useQueryState("view", viewModeParser)
```

The existing call sites keep working as-is: `setViewMode("map")` (line 113), the toggle buttons (`setViewMode("list")` / `setViewMode("map")`), and the functional updater `setViewMode((v) => (v === "list" ? "map" : v))` (line 157) — nuqs setters accept both values and updater functions.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — expected: no errors. (`useState` import stays — other state still uses it.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/view-mode.ts src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): view mode persists in the URL as ?view="
```

---

### Task 4: Mobile bottom tab bar

**Files:**
- Create: `src/lib/tab-bar.ts`
- Create: `src/components/layout/MobileTabBar.tsx`
- Test: `src/__tests__/tab-bar.test.ts`
- Modify: `src/components/layout/SiteHeader.tsx`
- Modify: `src/app/globals.css` (add `.pb-tabbar` utility)
- Modify: `src/components/browse/BrowsePage.tsx` (`<main>` clearance)
- Modify: `src/app/account/favorites/page.tsx`, `src/app/account/alerts/page.tsx`, `src/app/seller/listings/page.tsx` (clearance class)

**Interfaces:**
- Consumes: `NavItem`, `isActive`, `visibleNavItems` from `@/lib/navigation` (existing).
- Produces: `tabBarHiddenForPath(pathname: string): boolean` from `@/lib/tab-bar`; `MobileTabBar({ items }: { items: NavItem[] })` from `@/components/layout/MobileTabBar`; `.pb-tabbar` CSS utility (mobile-only bottom padding for the fixed bar).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/tab-bar.test.ts
import { describe, it, expect } from "vitest"
import { tabBarHiddenForPath } from "@/lib/tab-bar"

describe("tabBarHiddenForPath", () => {
  it("shows the tab bar on marketplace surfaces", () => {
    expect(tabBarHiddenForPath("/browse")).toBe(false)
    expect(tabBarHiddenForPath("/account/favorites")).toBe(false)
    expect(tabBarHiddenForPath("/account/alerts")).toBe(false)
    expect(tabBarHiddenForPath("/seller/listings")).toBe(false)
  })

  it("hides on listing detail (it has its own fixed contact CTA bar)", () => {
    expect(tabBarHiddenForPath("/listings/abc-123")).toBe(true)
    expect(tabBarHiddenForPath("/listings/abc-123/inquire")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/tab-bar.test.ts`
Expected: FAIL — cannot resolve `@/lib/tab-bar`.

- [ ] **Step 3: Write the pure rule**

```ts
// src/lib/tab-bar.ts
// Listing detail pages render their own fixed bottom contact bar
// (h-cta-spacer); stacking the tab bar under it would double the chrome, so
// the tab bar hides itself there.
export function tabBarHiddenForPath(pathname: string): boolean {
  return pathname.startsWith("/listings/")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/tab-bar.test.ts` — expected: PASS.

- [ ] **Step 5: Write the MobileTabBar component**

```tsx
// src/components/layout/MobileTabBar.tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { type NavItem, isActive } from "@/lib/navigation"
import { tabBarHiddenForPath } from "@/lib/tab-bar"

// Persistent bottom navigation on mobile (Zillow-style). Marketplace world
// only — SiteHeader renders it. Account/world-switch/sign-out stay in the
// hamburger drawer, so there is no "Menu" tab.

// Short labels for the tight tab layout; falls back to the nav label.
const TAB_LABELS: Record<string, string> = {
  "/account/alerts": "Alerts",
  "/seller/listings": "Listings",
}

const ICON_PROPS = {
  className: "w-6 h-6",
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  strokeWidth: 2,
  "aria-hidden": true,
} as const

const TAB_ICONS: Record<string, React.ReactNode> = {
  "/browse": (
    <svg {...ICON_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
    </svg>
  ),
  "/account/favorites": (
    <svg {...ICON_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
  "/account/alerts": (
    <svg {...ICON_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  ),
  "/seller/listings": (
    <svg {...ICON_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
}

export function MobileTabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  if (tabBarHiddenForPath(pathname)) return null

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-200 pb-safe"
    >
      <div className="flex">
        {items.map((item) => {
          const active = isActive(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[44px] flex-1 flex-col items-center gap-0.5 pt-1.5 pb-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-inset ${
                active ? "text-hs-red-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {TAB_ICONS[item.href] ?? TAB_ICONS["/browse"]}
              <span>{TAB_LABELS[item.href] ?? item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
```

- [ ] **Step 6: Render it from SiteHeader (marketplace only)**

Replace the return of `src/components/layout/SiteHeader.tsx`:

```tsx
import { deriveCapabilities, visibleNavItems, type NavWorld } from "@/lib/navigation"
import { MobileTabBar } from "./MobileTabBar"
```

```tsx
  return (
    <>
      <HeaderNav
        world={world}
        caps={caps}
        email={user.email ?? ""}
        title={title}
        subtitle={subtitle}
      />
      {world === "marketplace" && <MobileTabBar items={visibleNavItems(world, caps)} />}
    </>
  )
```

(Fixed positioning escapes the browse page's clamped shell, so render order doesn't matter.)

- [ ] **Step 7: Add the clearance utility and apply it**

In `src/app/globals.css`, next to the existing `.pb-safe` block:

```css
/* Reserve room for the fixed mobile tab bar (MobileTabBar). Mobile-only so
   desktop layouts are untouched; height ≈ 3.5rem bar + home-indicator inset. */
@media (max-width: 47.9375rem) {
  .pb-tabbar {
    padding-bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px));
  }
}
```

Apply it:
1. `src/components/browse/BrowsePage.tsx` — add `pb-tabbar` to the `<main>` class list (line 197): `className="flex flex-col flex-1 min-h-0 bg-gray-50 pb-tabbar"`. Because the browse shell is `h-[100dvh] overflow-hidden`, padding the main column is the only correct way to keep the map/list above the bar (body padding would make the body scrollable).
2. `src/app/account/favorites/page.tsx`, `src/app/account/alerts/page.tsx`, `src/app/seller/listings/page.tsx` — add `pb-tabbar` to each page's outermost content wrapper `<div>` (the first container below `SiteHeader`). These pages scroll normally, so the padding just prevents the bar covering the last row of content. If a page's wrapper already has a `pb-*` class, append `pb-tabbar` after it (the unlayered utility wins on mobile).

- [ ] **Step 8: Typecheck and full test run**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npx vitest run` — expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/tab-bar.ts src/components/layout/MobileTabBar.tsx src/__tests__/tab-bar.test.ts src/components/layout/SiteHeader.tsx src/app/globals.css src/components/browse/BrowsePage.tsx src/app/account/favorites/page.tsx src/app/account/alerts/page.tsx src/app/seller/listings/page.tsx
git commit -m "feat(nav): mobile bottom tab bar for marketplace pages"
```

---

### Task 5: Compact 2-row mobile browse header

**Files:**
- Create: `src/components/browse/BrowseHeaderSearch.tsx`
- Modify: `src/components/layout/HeaderNav.tsx` (row-1 layout + context tier)
- Modify: `src/components/layout/SiteHeader.tsx` (prop pass-through)
- Modify: `src/app/browse/page.tsx` (pass the search slot)

**Interfaces:**
- Consumes: `viewModeParser` (Task 3), `useListingFilters` + `DEFAULT_RADIUS_MILES` from `./FilterBar` (existing), `LocationSearch` from `./LocationSearchDynamic` (existing).
- Produces: `HeaderNav`/`SiteHeader` gain optional `mobileSearch?: React.ReactNode`. When set: row 1 shows the slot between logo and hamburger on mobile, and the contextual title tier becomes `hidden md:block`. When absent: byte-for-byte current behavior (all other pages).

- [ ] **Step 1: Write BrowseHeaderSearch**

The header is a server-rendered tree separate from BrowsePage, so the search wires itself to browse state through nuqs (the URL) — no callbacks across the boundary:

```tsx
// src/components/browse/BrowseHeaderSearch.tsx
"use client"

import { useQueryState } from "nuqs"
import { viewModeParser } from "@/lib/view-mode"
import { useListingFilters, DEFAULT_RADIUS_MILES } from "./FilterBar"
import { LocationSearch } from "./LocationSearchDynamic"

// Mobile browse header search (row 1 of the compact header). Mirrors
// BrowsePage.handleLocationSelect exactly, but communicates via nuqs since it
// renders in the server header tree, not under BrowsePage.
export function BrowseHeaderSearch() {
  const [rawFilters, setFilters] = useListingFilters()
  const [, setView] = useQueryState("view", viewModeParser)

  function handleSelect(location: { lng: number; lat: number; name: string }) {
    setFilters(
      {
        centerLat: location.lat,
        centerLng: location.lng,
        centerLabel: location.name,
        radiusMiles: rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES,
      },
      { shallow: false }
    )
    setView("map")
  }

  return <LocationSearch onSelect={handleSelect} />
}
```

- [ ] **Step 2: Add the mobileSearch slot to HeaderNav**

In `src/components/layout/HeaderNav.tsx`:

1. Extend the props interface:

```tsx
interface HeaderNavProps {
  world: NavWorld
  caps: Capabilities
  email: string
  title?: string
  subtitle?: string
  /** Mobile-only search slot for row 1 (browse). Also hides the contextual
      title tier on mobile so the header is 1 red row + the page's pill row. */
  mobileSearch?: React.ReactNode
}
```

2. Destructure `mobileSearch` in the signature.

3. In the top tier (line 53's flex row), insert the slot between `<Logo>` and the desktop menu block:

```tsx
        <div className="flex items-center justify-between h-14 gap-3">
          <Logo href={logoHref} />
          {mobileSearch && <div className="flex-1 min-w-0 md:hidden">{mobileSearch}</div>}
          <div className="hidden md:flex items-center gap-3">
```

4. Hide the contextual bottom tier on mobile when the slot is present — change line 73:

```tsx
      <div className={`border-t border-white/15 ${mobileSearch ? "hidden md:block" : ""}`}>
```

- [ ] **Step 3: Pass through SiteHeader and wire the browse page**

`src/components/layout/SiteHeader.tsx` — add `mobileSearch?: React.ReactNode` to `SiteHeaderProps`, destructure it, and forward: `<HeaderNav ... mobileSearch={mobileSearch} />`.

`src/app/browse/page.tsx` — import and pass:

```tsx
import { BrowseHeaderSearch } from "@/components/browse/BrowseHeaderSearch"
```

```tsx
      <SiteHeader
        world="marketplace"
        title="Browse Listings"
        subtitle={`${count} active listing${count !== 1 ? "s" : ""}`}
        mobileSearch={<BrowseHeaderSearch />}
      />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/BrowseHeaderSearch.tsx src/components/layout/HeaderNav.tsx src/components/layout/SiteHeader.tsx src/app/browse/page.tsx
git commit -m "feat(browse): compact mobile header with in-bar location search"
```

---

### Task 6: Mobile pill row (Filters · radius · Save search)

**Files:**
- Create: `src/lib/filter-count.ts`
- Test: `src/__tests__/filter-count.test.ts`
- Modify: `src/components/browse/BrowsePage.tsx` (view-controls section, lines 203–333)

**Interfaces:**
- Produces: `countListingFilters(f: CountableFilters): number` from `@/lib/filter-count` — total active filters for the mobile Filters badge (each facet counts once: keyword, types, states, price range, years, inventory, location).
- BrowsePage layout contract after this task: the existing controls row is desktop-only (`hidden md:block`); mobile gets a new pill row. The mobile Filters button, mobile LocationSearch, and the segmented toggle disappear from mobile (toggle replaced by Task 7's floating pills; search moved to the header in Task 5).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/filter-count.test.ts
import { describe, it, expect } from "vitest"
import { countListingFilters, type CountableFilters } from "@/lib/filter-count"

const NONE: CountableFilters = {
  query: "",
  types: [],
  states: [],
  minPrice: null,
  maxPrice: null,
  minYearsOpen: null,
  inventoryIncluded: false,
  centerLat: null,
}

describe("countListingFilters", () => {
  it("returns 0 with no active filters", () => {
    expect(countListingFilters(NONE)).toBe(0)
  })

  it("counts each facet once", () => {
    expect(
      countListingFilters({
        ...NONE,
        query: "salon",
        types: ["suite", "flagship"],
        states: ["ID"],
        minPrice: 100_000_00,
        maxPrice: 500_000_00,
        minYearsOpen: 2,
        inventoryIncluded: true,
        centerLat: 43.6,
      })
    ).toBe(7)
  })

  it("counts a price range as one facet and ignores minYearsOpen of 0", () => {
    expect(countListingFilters({ ...NONE, minPrice: 100_00 })).toBe(1)
    expect(countListingFilters({ ...NONE, minPrice: 100_00, maxPrice: 200_00 })).toBe(1)
    expect(countListingFilters({ ...NONE, minYearsOpen: 0 })).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/filter-count.test.ts`
Expected: FAIL — cannot resolve `@/lib/filter-count`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/filter-count.ts
// Active-filter count for the mobile Filters pill badge. Mirrors
// FilterBar.hasActiveFilters, but as a count and shared/testable.

export interface CountableFilters {
  query: string
  types: string[]
  states: string[]
  minPrice: number | null
  maxPrice: number | null
  minYearsOpen: number | null
  inventoryIncluded: boolean
  centerLat: number | null
}

export function countListingFilters(f: CountableFilters): number {
  return (
    (f.query ? 1 : 0) +
    (f.types.length > 0 ? 1 : 0) +
    (f.states.length > 0 ? 1 : 0) +
    (f.minPrice !== null || f.maxPrice !== null ? 1 : 0) +
    (f.minYearsOpen !== null && f.minYearsOpen > 0 ? 1 : 0) +
    (f.inventoryIncluded ? 1 : 0) +
    (f.centerLat !== null ? 1 : 0)
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/filter-count.test.ts` — expected: PASS.

- [ ] **Step 5: Restructure the BrowsePage controls**

In `src/components/browse/BrowsePage.tsx`:

1. Import: `import { countListingFilters } from "@/lib/filter-count"`.
2. Compute below the `filters` object: `const activeFilterCount = countListingFilters(rawFilters)`.
3. Make the existing view-controls wrapper desktop-only — change line 204 from `<div className="bg-white border-b border-gray-200 shrink-0">` to:

```tsx
      <div className="hidden md:block bg-white border-b border-gray-200 shrink-0">
```

4. Inside it, delete the now-dead mobile-only elements: the `md:hidden` Filters button (lines 206–215) and the `md:hidden` LocationSearch wrapper (lines 263–265). Everything else (segmented toggle, radius slider, SaveSearchButton) stays exactly as-is for desktop.
5. Insert the mobile pill row immediately after the closing `</div>` of the desktop controls wrapper:

```tsx
      {/* Mobile pill row — Zillow-style second header row. Scrolls horizontally
         if the radius chip makes it overflow. */}
      <div className="md:hidden bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
          <button
            onClick={() => setMobileFiltersOpen(true)}
            className="flex shrink-0 items-center gap-2 rounded-full border border-gray-300 bg-white px-4 min-h-[44px] text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-hs-red-600 px-1.5 text-[11px] font-bold text-white tabular-nums">
                {activeFilterCount}
              </span>
            )}
          </button>

          {searchCenter && (
            <button
              type="button"
              onClick={handleClearLocation}
              title={`Clear location: ${rawFilters.centerLabel}`}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-hs-red-50 px-3 min-h-[44px] max-w-[180px] text-sm font-medium text-hs-red-700 hover:bg-hs-red-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
            >
              <span className="truncate">
                {rawFilters.centerLabel || "Location"} · {rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES} mi
              </span>
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <div className="shrink-0 ml-auto">
            <SaveSearchButton
              filters={{
                query: rawFilters.query || undefined,
                types: rawFilters.types,
                states: rawFilters.states,
                minPrice: rawFilters.minPrice,
                maxPrice: rawFilters.maxPrice,
                minYearsOpen: rawFilters.minYearsOpen,
                inventoryIncluded: rawFilters.inventoryIncluded,
                sort: rawFilters.sort,
                centerLat: rawFilters.centerLat,
                centerLng: rawFilters.centerLng,
                radiusMiles: rawFilters.radiusMiles,
                centerLabel: rawFilters.centerLabel || undefined,
                includeListings: rawFilters.showListings,
                includeCompetitors: rawFilters.showCompetitors,
              }}
            />
          </div>
        </div>
      </div>
```

Note: the mobile radius chip clears the location on tap; radius *adjustment* on mobile moves into the filter sheet's Location section (Task 10). The desktop slider is unchanged.

- [ ] **Step 6: Typecheck and full test run**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npx vitest run` — expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/filter-count.ts src/__tests__/filter-count.test.ts src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): mobile pill row with filter-count badge"
```

---

### Task 7: Floating List / Map|Sort pills + sort bottom sheet

**Files:**
- Create: `src/components/browse/FloatingViewToggle.tsx`
- Modify: `src/components/browse/FilterBar.tsx` (export `SORT_OPTIONS`)
- Modify: `src/components/browse/BrowsePage.tsx` (mount pills + sort sheet)

**Interfaces:**
- Consumes: `BottomSheet` (Task 2), `ViewMode` (Task 3), `SORT_OPTIONS` (exported this task: `{ label: string; value: string; requiresCenter?: boolean }[]`).
- Produces: `FloatingViewToggle({ viewMode, onViewChange, onSortClick }: { viewMode: ViewMode; onViewChange: (mode: ViewMode) => void; onSortClick: () => void })` — a mobile-only, absolutely-positioned pill; its parent must be `relative`.

- [ ] **Step 1: Export SORT_OPTIONS from FilterBar**

In `src/components/browse/FilterBar.tsx` line 21, change `const SORT_OPTIONS = [` to `export const SORT_OPTIONS = [`.

- [ ] **Step 2: Write the floating pill component**

```tsx
// src/components/browse/FloatingViewToggle.tsx
"use client"

import type { ViewMode } from "@/lib/view-mode"

// Zillow-style floating pill, bottom-center over the map or list (mobile
// only). Map view shows a single "List" action; list view shows "Map | Sort".
// Parent container must be `relative`; the browse main already reserves
// tab-bar clearance (pb-tabbar), so bottom-4 sits above the tab bar.

interface FloatingViewToggleProps {
  viewMode: ViewMode
  onViewChange: (mode: ViewMode) => void
  onSortClick: () => void
}

const BTN =
  "flex items-center gap-2 px-4 min-h-[44px] text-sm font-bold text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"

export function FloatingViewToggle({ viewMode, onViewChange, onSortClick }: FloatingViewToggleProps) {
  return (
    <div className="md:hidden absolute bottom-4 left-1/2 z-20 -translate-x-1/2 flex overflow-hidden rounded-full border border-gray-200 bg-white shadow-lg">
      {viewMode === "map" ? (
        <button type="button" onClick={() => onViewChange("list")} className={BTN}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
          List
        </button>
      ) : (
        <>
          <button type="button" onClick={() => onViewChange("map")} className={BTN}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            Map
          </button>
          <span className="my-2 w-px bg-gray-200" aria-hidden="true" />
          <button type="button" onClick={onSortClick} className={BTN}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h5m8-8v12m0 0l-4-4m4 4l4-4" />
            </svg>
            Sort
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Mount the pills and the sort sheet in BrowsePage**

In `src/components/browse/BrowsePage.tsx`:

1. Imports:

```tsx
import { FloatingViewToggle } from "./FloatingViewToggle"
import { BottomSheet } from "@/components/ui"
import { SORT_OPTIONS } from "./FilterBar"  // merge into the existing FilterBar import
```

2. State, next to `mobileFiltersOpen`:

```tsx
  const [sortSheetOpen, setSortSheetOpen] = useState(false)
```

3. **List view**: wrap the list container (line 341) so the pill can float over it — change:

```tsx
          <div className="h-full overflow-y-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <BrowseListContent ... />
            </div>
          </div>
```

to:

```tsx
          <div className="relative h-full">
            <div className="h-full overflow-y-auto">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20 md:pb-6">
                <BrowseListContent ... />
              </div>
            </div>
            <FloatingViewToggle
              viewMode={viewMode}
              onViewChange={setViewMode}
              onSortClick={() => setSortSheetOpen(true)}
            />
          </div>
```

(`pb-20 md:pb-6` keeps the last card tappable beneath the floating pill; `BrowseListContent` props unchanged.)

4. **Map view**: inside the map panel div (line 383, `className="w-full md:w-2/3 relative"`), after `<MapLegend />`, add:

```tsx
              <FloatingViewToggle
                viewMode={viewMode}
                onViewChange={setViewMode}
                onSortClick={() => setSortSheetOpen(true)}
              />
```

5. **Sort sheet**, next to `<MobileFilterDrawer ... />` at the bottom of the JSX:

```tsx
      {/* Mobile sort sheet (desktop uses the FilterBar <select>) */}
      <BottomSheet open={sortSheetOpen} onClose={() => setSortSheetOpen(false)} title="Sort">
        <div role="radiogroup" aria-label="Sort listings">
          {SORT_OPTIONS.filter((o) => !o.requiresCenter || searchCenter !== null).map((o) => {
            const selected = rawFilters.sort === o.value
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setFilters({ sort: o.value })
                  setSortSheetOpen(false)
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 min-h-[44px] text-left text-sm font-medium transition-colors ${
                  selected ? "bg-hs-red-50 text-hs-red-700" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {o.label}
                {selected && (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      </BottomSheet>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/FloatingViewToggle.tsx src/components/browse/FilterBar.tsx src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): floating List/Map|Sort pills with mobile sort sheet"
```

---

### Task 8: Mobile map layers (FAB + bottom sheet, legend desktop-only)

**Files:**
- Modify: `src/components/browse/MapLegend.tsx` (extract exported `MapLayerRows`)
- Create: `src/components/browse/MobileMapLayers.tsx`
- Modify: `src/components/browse/BrowsePage.tsx` (hide legend on mobile, mount FAB)
- Modify: `src/app/globals.css` (hide compass control on mobile)

**Interfaces:**
- Consumes: `BottomSheet` (Task 2), `useListingFilters` (existing).
- Produces: `MapLayerRows()` exported from `./MapLegend` — the full set of layer-toggle rows (no positioning/panel chrome), self-contained via `useListingFilters()`. Consumed by both `MapLegend` (desktop panel) and `MobileMapLayers` (sheet).

- [ ] **Step 1: Extract MapLayerRows from MapLegend**

In `src/components/browse/MapLegend.tsx`, move the panel body (currently everything inside the `{!collapsed && (...)}` block except the hint paragraph — i.e. the four `ToggleRow`s and the competitors sub-rows, lines 138–172) into a new exported component in the same file:

```tsx
/** The layer-toggle rows, shared by the desktop legend panel and the mobile
    layers sheet. Self-contained: reads/writes the nuqs layer flags itself. */
export function MapLayerRows() {
  const [filters, setFilters] = useListingFilters()
  const compActive = filters.showCompetitors

  return (
    <>
      <ToggleRow
        label="Your locations"
        active={filters.showMyLocations}
        onClick={() => setFilters({ showMyLocations: !filters.showMyLocations })}
        swatch={<BadgeSwatch src="/markers/hs-marker-owner.png" />}
        titleOverride={filters.showMyLocations ? "Show your locations in the normal marks" : "Highlight your locations with the Hello Sugar badge"}
      />
      <ToggleRow
        label="For sale"
        active={filters.showListings}
        onClick={() => setFilters({ showListings: !filters.showListings })}
        swatch={<IconSwatch src="/markers/hs-marker-color.png" />}
      />
      <ToggleRow
        label="Hello Sugar (not listed)"
        active={filters.showHsLocations}
        onClick={() => setFilters({ showHsLocations: !filters.showHsLocations })}
        swatch={<IconSwatch src="/markers/hs-marker-white.png" halo />}
      />

      <div className="mt-1.5 border-t border-gray-100 pt-1.5">
        <ToggleRow
          label="Competitors"
          active={compActive}
          onClick={() => setFilters({ showCompetitors: !filters.showCompetitors })}
        />
        <div className={`flex items-center gap-2 py-0.5 pl-6 text-xs ${compActive ? "text-gray-500" : "text-gray-300"}`}>
          <Diamond color="var(--color-warning)" />
          <span>Opportunity</span>
        </div>
        <div className={`flex items-center gap-2 py-0.5 pl-6 text-xs ${compActive ? "text-gray-500" : "text-gray-300"}`}>
          <DiamondHollow />
          <span>Closed</span>
        </div>
      </div>
    </>
  )
}
```

Then reduce `MapLegend`'s expanded body to:

```tsx
      {!collapsed && (
        <div className="px-3 pb-3">
          <p className="pb-1.5 text-[10px] leading-snug text-gray-400">
            Click a row to show or hide it on the map
          </p>
          <MapLayerRows />
        </div>
      )}
```

(`MapLegend` no longer needs its own `useListingFilters` call — remove the now-unused `filters`/`setFilters`/`compActive` from it, keeping only the `collapsed` state.)

- [ ] **Step 2: Write the mobile layers FAB + sheet**

```tsx
// src/components/browse/MobileMapLayers.tsx
"use client"

import { useState } from "react"
import { BottomSheet } from "@/components/ui"
import { MapLayerRows } from "./MapLegend"

// Mobile replacement for the always-open MapLegend panel: a small circular
// layers button over the map that opens the layer toggles in a bottom sheet.
export function MobileMapLayers() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Map key and layers"
        className="md:hidden absolute bottom-4 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-lg hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" />
        </svg>
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Map key">
        <p className="pb-2 text-xs text-gray-400">Tap a row to show or hide it on the map</p>
        <MapLayerRows />
      </BottomSheet>
    </>
  )
}
```

- [ ] **Step 3: Wire into BrowsePage and hide the legend + compass on mobile**

In `src/components/browse/BrowsePage.tsx` (map panel, around line 405):

```tsx
import { MobileMapLayers } from "./MobileMapLayers"
```

```tsx
              {/* Desktop keeps the always-available legend panel; mobile gets
                 the layers FAB + bottom sheet instead. */}
              <div className="hidden md:block">
                <MapLegend />
              </div>
              <MobileMapLayers />
```

In `src/app/globals.css`, near the other mobile media utilities:

```css
/* Mobile map chrome: pitch/compass reset isn't useful on small screens. */
@media (max-width: 47.9375rem) {
  .maplibregl-ctrl-compass {
    display: none !important;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/MapLegend.tsx src/components/browse/MobileMapLayers.tsx src/components/browse/BrowsePage.tsx src/app/globals.css
git commit -m "feat(browse): mobile layers button + bottom sheet replace map key panel"
```

---

### Task 9: Favorites hearts on listing cards

**Files:**
- Modify: `src/lib/favorites-actions.ts` (add `getFavoriteListingIds`)
- Create: `src/components/browse/FavoriteHeart.tsx`
- Modify: `src/components/browse/ListingCard.tsx` (heart in both layouts)
- Modify: `src/components/browse/ListingGrid.tsx` (favoriteIds → per-card)
- Modify: `src/app/browse/page.tsx` (fetch + pass favoriteIds)

**Interfaces:**
- Consumes: existing `toggleFavorite(listingId): Promise<{ favorited: boolean }>` server action; existing `favoriteIds` prop chain (page → BrowsePage → BrowseListContent → ListingGrid, already typed end-to-end).
- Produces: `getFavoriteListingIds(): Promise<string[]>` from `@/lib/favorites-actions` (empty array when signed out); `FavoriteHeart({ listingId, initialFavorited }: { listingId: string; initialFavorited: boolean })`; `ListingCard` gains optional `favorited?: boolean` (heart renders only when the prop is provided — `undefined` keeps every other call site of ListingCard rendering exactly as today).

- [ ] **Step 1: Add the ids query to favorites-actions**

Append to `src/lib/favorites-actions.ts` (imports `auth`, `db`, `favorites`, `eq` already present):

```ts
export async function getFavoriteListingIds(): Promise<string[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const rows = await db.query.favorites.findMany({
    where: eq(favorites.userId, session.user.id),
    columns: { listingId: true },
  })
  return rows.map((r) => r.listingId)
}
```

- [ ] **Step 2: Write FavoriteHeart**

Modeled on the proven `FavoriteButtonLarge` optimistic pattern (`src/app/listings/[id]/FavoriteButtonLarge.tsx`), icon-only, and safe inside a card `<Link>`:

```tsx
// src/components/browse/FavoriteHeart.tsx
"use client"

import { useOptimistic, useState, useTransition } from "react"
import { toggleFavorite } from "@/lib/favorites-actions"

// Icon-only optimistic favorite toggle for browse cards. Lives INSIDE the
// card's <Link>, so it must preventDefault/stopPropagation to not navigate.
// Same confirmed-state + useOptimistic pattern as FavoriteButtonLarge: on
// failure the optimistic value auto-reverts to the last confirmed state.
interface FavoriteHeartProps {
  listingId: string
  initialFavorited: boolean
}

export function FavoriteHeart({ listingId, initialFavorited }: FavoriteHeartProps) {
  const [isPending, startTransition] = useTransition()
  const [favorited, setFavorited] = useState(initialFavorited)
  const [optimisticFavorited, setOptimisticFavorited] = useOptimistic(favorited)

  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (isPending) return
    startTransition(async () => {
      setOptimisticFavorited(!optimisticFavorited)
      try {
        const result = await toggleFavorite(listingId)
        setFavorited(result.favorited)
      } catch {
        // Optimistic update auto-reverts to the last confirmed value.
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={optimisticFavorited ? "Remove from saved listings" : "Save listing"}
      aria-pressed={optimisticFavorited}
      aria-busy={isPending}
      className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
    >
      <svg
        className={`h-6 w-6 transition-colors ${isPending ? "animate-pulse" : ""} ${
          optimisticFavorited ? "text-hs-red-600" : "text-black/35"
        }`}
        viewBox="0 0 24 24"
        fill="currentColor"
        stroke="white"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}
```

(Zillow-style: white-stroked heart floating on the photo — translucent dark fill when unsaved, crimson when saved.)

- [ ] **Step 3: Render the heart in ListingCard**

In `src/components/browse/ListingCard.tsx`:

1. `import { FavoriteHeart } from "./FavoriteHeart"` (a client child inside a server-compatible component — fine).
2. Add to `ListingCardProps`:

```tsx
  // When provided, renders the favorite heart (browse grid). Undefined keeps
  // the card exactly as before for call sites without favorites data.
  favorited?: boolean
```

3. Destructure `favorited` in the signature.
4. **Default layout** — inside the photo `<div>` (after the type-badge block, line 147), add:

```tsx
        {/* Favorite heart overlay */}
        {favorited !== undefined && (
          <div className="absolute top-2 right-2">
            <FavoriteHeart listingId={listing.id} initialFavorited={favorited} />
          </div>
        )}
```

5. **Compact layout** — in the price/badge row (line 75), add the heart after the type badge:

```tsx
          <div className="flex items-center justify-between gap-2">
            <p className="text-base font-bold text-hs-red-600 tracking-tight tabular-nums">
              {formatPrice(listing.askingPrice)}
            </p>
            <span className="flex items-center gap-1">
              <span
                className={`
                  shrink-0 inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-md
                  ${TYPE_COLORS[listing.type] ?? "bg-gray-100 text-gray-700"}
                `}
              >
                {TYPE_LABELS[listing.type] ?? listing.type}
              </span>
              {favorited !== undefined && (
                <span className="-my-2 -mr-2">
                  <FavoriteHeart listingId={listing.id} initialFavorited={favorited} />
                </span>
              )}
            </span>
          </div>
```

- [ ] **Step 4: Wire favoriteIds through ListingGrid**

In `src/components/browse/ListingGrid.tsx`:

1. Destructure `favoriteIds = []` in the signature (replacing the inert-prop comment on lines 15–18 with: `// Favorited listing ids — rendered as the heart on each card.`).
2. Add `import { useMemo } from "react"` (merge into the existing react import) and above the return:

```tsx
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
```

3. Pass to each card (line 112):

```tsx
          <ListingCard
            key={listing.id}
            listing={listing}
            isHovered={hoveredId === listing.id}
            onHover={onHover}
            compact={singleColumn}
            favorited={favoriteSet.has(listing.id)}
          />
```

- [ ] **Step 5: Fetch favorites on the browse page**

In `src/app/browse/page.tsx`:

```tsx
import { getFavoriteListingIds } from "@/lib/favorites-actions"
```

Extend the `Promise.all` (line 70):

```tsx
  const [{ items: initialListings }, competitorClosures, savedCompetitorIds, hsLocations, mapOwnership, favoriteIds] =
    await Promise.all([
      getListings(filters),
      getCompetitorClosures({ ... }),          // unchanged
      getSavedCompetitorPlaceIds(),
      getUnlistedHsLocations({ ... }),         // unchanged
      getMyMapOwnership(),
      getFavoriteListingIds(),
    ])
```

And pass it:

```tsx
      <BrowsePage
        initialListings={initialListings}
        competitorClosures={competitorClosures}
        savedCompetitorIds={savedCompetitorIds}
        hsLocations={hsLocations}
        mapOwnership={mapOwnership}
        favoriteIds={favoriteIds}
      />
```

(`BrowsePage` and `BrowseListContent` already accept and forward `favoriteIds` — no changes needed there.)

Known limitation (accepted in design): `toggleFavorite` revalidates only the listing detail path, so `/browse`'s server-fetched `favoriteIds` may be stale after navigating away and back within the cache window; the heart's client state is correct during the session and `/account/favorites` reads live data.

- [ ] **Step 6: Typecheck and full test run**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npx vitest run` — expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/favorites-actions.ts src/components/browse/FavoriteHeart.tsx src/components/browse/ListingCard.tsx src/components/browse/ListingGrid.tsx src/app/browse/page.tsx
git commit -m "feat(browse): favorites hearts on listing cards"
```

---

### Task 10: Full-screen mobile filter sheet

**Files:**
- Modify: `src/components/browse/FilterBar.tsx` (export reusable pieces)
- Create: `src/components/browse/MobileFilterSheet.tsx`
- Modify: `src/components/browse/BrowsePage.tsx` (swap drawer → sheet)
- Delete: `src/components/browse/MobileFilterDrawer.tsx`

**Interfaces:**
- Consumes: `FullScreenSheet` (Task 2); from `./FilterBar` (exported this task): `LISTING_TYPES`, `TIME_OPEN_OPTIONS`, `StatePanel({ selected, onToggle, onClear })`, `PriceInput({ value, onChange, placeholder, onEnter })`, plus already-exported `useListingFilters`, `RADIUS_MIN_MILES`, `RADIUS_MAX_MILES`, `DEFAULT_RADIUS_MILES`.
- Produces: `MobileFilterSheet({ open, onClose, onLocationSelect }: { open: boolean; onClose: () => void; onLocationSelect: (location: { lng: number; lat: number; name: string }) => void })` — drop-in replacement for `MobileFilterDrawer` (same three props, so BrowsePage's call site changes only the component name).

- [ ] **Step 1: Export the reusable pieces from FilterBar**

In `src/components/browse/FilterBar.tsx` add `export` to: `const LISTING_TYPES` (line 15), `const TIME_OPEN_OPTIONS` (line 28), `function StatePanel` (line 370), `function PriceInput` (line 460).

- [ ] **Step 2: Write MobileFilterSheet**

```tsx
// src/components/browse/MobileFilterSheet.tsx
"use client"

import { useEffect, useState } from "react"
import { FullScreenSheet } from "@/components/ui"
import {
  useListingFilters,
  LISTING_TYPES,
  TIME_OPEN_OPTIONS,
  StatePanel,
  PriceInput,
  RADIUS_MIN_MILES,
  RADIUS_MAX_MILES,
  DEFAULT_RADIUS_MILES,
} from "./FilterBar"
import { LocationSearch } from "./LocationSearchDynamic"

// Purpose-built mobile filters: full-screen sheet with stacked sections
// (no popovers). Filters stay live-applied through the same nuqs state the
// desktop FilterBar uses — the footer button just closes the sheet. A true
// live result count isn't available client-side (listings paginate at 12),
// so the footer reads "Show results".

interface MobileFilterSheetProps {
  open: boolean
  onClose: () => void
  onLocationSelect: (location: { lng: number; lat: number; name: string }) => void
}

const SECTION = "border-b border-gray-100 pb-5 mb-5"
const SECTION_TITLE = "text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2"

export function MobileFilterSheet({ open, onClose, onLocationSelect }: MobileFilterSheetProps) {
  const [filters, setFilters] = useListingFilters()

  // Price entry is committed on blur/Enter (typing cents live would thrash the
  // URL); local text state mirrors the URL like the desktop PricePanel.
  const [minPriceText, setMinPriceText] = useState("")
  const [maxPriceText, setMaxPriceText] = useState("")
  // Live radius while dragging; committed on release like the desktop slider.
  const [draftRadius, setDraftRadius] = useState<number | null>(null)

  // Re-sync local text when the sheet opens (URL may have changed elsewhere).
  useEffect(() => {
    if (!open) return
    setMinPriceText(filters.minPrice != null ? String(Math.round(filters.minPrice / 100)) : "")
    setMaxPriceText(filters.maxPrice != null ? String(Math.round(filters.maxPrice / 100)) : "")
    setDraftRadius(null)
    // Intentionally only on open — the sheet owns the fields while visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const toCents = (v: string) => {
    const digits = v.replace(/[^0-9]/g, "")
    return digits ? Number(digits) * 100 : null
  }
  const commitPrices = () =>
    setFilters({ minPrice: toCents(minPriceText), maxPrice: toCents(maxPriceText) })

  function toggleType(value: string) {
    const updated = filters.types.includes(value)
      ? filters.types.filter((t) => t !== value)
      : [...filters.types, value]
    setFilters({ types: updated })
  }

  function toggleState(value: string) {
    const updated = filters.states.includes(value)
      ? filters.states.filter((s) => s !== value)
      : [...filters.states, value]
    setFilters({ states: updated })
  }

  function clearAll() {
    setMinPriceText("")
    setMaxPriceText("")
    setFilters(
      {
        query: null,
        types: [],
        states: [],
        minPrice: null,
        maxPrice: null,
        sort: "newest",
        minYearsOpen: null,
        inventoryIncluded: false,
        centerLat: null,
        centerLng: null,
        radiusMiles: null,
        centerLabel: null,
      },
      { shallow: false }
    )
  }

  const hasCenter = filters.centerLat !== null && filters.centerLng !== null

  return (
    <FullScreenSheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 px-4 min-h-[44px] rounded-lg text-sm font-semibold text-hs-red-600 hover:bg-hs-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] rounded-xl bg-hs-red-600 text-white text-base font-bold hover:bg-hs-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            Show results
          </button>
        </div>
      }
    >
      {/* Location + radius */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Location</h3>
        <LocationSearch onSelect={onLocationSelect} />
        {hasCenter && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm font-medium text-gray-700">
              <span className="truncate">{filters.centerLabel || "Selected location"}</span>
              <span className="tabular-nums shrink-0">
                {draftRadius ?? filters.radiusMiles ?? DEFAULT_RADIUS_MILES} mi
              </span>
            </div>
            <input
              type="range"
              min={RADIUS_MIN_MILES}
              max={RADIUS_MAX_MILES}
              step={1}
              value={draftRadius ?? filters.radiusMiles ?? DEFAULT_RADIUS_MILES}
              onChange={(e) => setDraftRadius(Number(e.target.value))}
              onPointerUp={(e) => {
                setDraftRadius(null)
                setFilters({ radiusMiles: Number(e.currentTarget.value) }, { shallow: false })
              }}
              onKeyUp={(e) => {
                setDraftRadius(null)
                setFilters({ radiusMiles: Number(e.currentTarget.value) }, { shallow: false })
              }}
              aria-label="Search radius in miles"
              className="mt-1 w-full h-2 cursor-pointer accent-hs-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500/40 rounded-full"
            />
            <button
              type="button"
              onClick={() =>
                setFilters(
                  {
                    centerLat: null,
                    centerLng: null,
                    centerLabel: null,
                    radiusMiles: null,
                    sort: filters.sort === "distance" ? "newest" : filters.sort,
                  },
                  { shallow: false }
                )
              }
              className="mt-2 text-sm font-semibold text-hs-red-600 hover:text-hs-red-700 min-h-[44px]"
            >
              Clear location
            </button>
          </div>
        )}
      </div>

      {/* Listing type */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Listing type</h3>
        {LISTING_TYPES.map((t) => {
          const checked = filters.types.includes(t.value)
          return (
            <label key={t.value} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-base">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleType(t.value)}
                className="h-5 w-5 accent-hs-red-600"
              />
              {t.label}
            </label>
          )
        })}
      </div>

      {/* Price */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Price range</h3>
        <div className="flex items-center gap-2" onBlur={commitPrices}>
          <PriceInput value={minPriceText} onChange={setMinPriceText} placeholder="Min" onEnter={commitPrices} />
          <span className="text-gray-400">–</span>
          <PriceInput value={maxPriceText} onChange={setMaxPriceText} placeholder="Max" onEnter={commitPrices} />
        </div>
      </div>

      {/* Keyword */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Keyword</h3>
        <input
          type="text"
          value={filters.query}
          onChange={(e) => setFilters({ query: e.target.value || null })}
          placeholder="Salon name, city, notes…"
          className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-base focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
        />
      </div>

      {/* State */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>State</h3>
        <StatePanel
          selected={filters.states}
          onToggle={toggleState}
          onClear={() => setFilters({ states: [] })}
        />
      </div>

      {/* Years open */}
      <div className={SECTION}>
        <h3 className={SECTION_TITLE}>Minimum years open</h3>
        {TIME_OPEN_OPTIONS.map((o) => {
          const checked = (filters.minYearsOpen ?? 0) === o.value
          return (
            <label key={o.value} className="flex min-h-[44px] cursor-pointer items-center gap-3 text-base">
              <input
                type="radio"
                name="sheet-years-open"
                checked={checked}
                onChange={() => setFilters({ minYearsOpen: o.value || null })}
                className="h-5 w-5 accent-hs-red-600"
              />
              {o.label}
            </label>
          )
        })}
      </div>

      {/* Inventory */}
      <div className="pb-2">
        <h3 className={SECTION_TITLE}>Inventory</h3>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-base">
          <input
            type="checkbox"
            checked={filters.inventoryIncluded}
            onChange={(e) => setFilters({ inventoryIncluded: e.target.checked })}
            className="h-5 w-5 accent-hs-red-600"
          />
          Inventory included only
        </label>
      </div>
    </FullScreenSheet>
  )
}
```

- [ ] **Step 3: Swap it into BrowsePage and delete the old drawer**

In `src/components/browse/BrowsePage.tsx`:
- Replace the import: `import { MobileFilterDrawer } from "./MobileFilterDrawer"` → `import { MobileFilterSheet } from "./MobileFilterSheet"`.
- Replace the JSX at the bottom:

```tsx
      {/* Mobile filter sheet */}
      <MobileFilterSheet
        isOpen={...}   ← rename: the sheet uses `open`
```

Exact replacement:

```tsx
      {/* Mobile filter sheet */}
      <MobileFilterSheet
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        onLocationSelect={handleLocationSelect}
      />
```

Delete the old component:

```bash
git rm src/components/browse/MobileFilterDrawer.tsx
```

- [ ] **Step 4: Typecheck and full test run**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npx vitest run` — expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/FilterBar.tsx src/components/browse/MobileFilterSheet.tsx src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): full-screen mobile filter sheet replaces drawer"
```

---

### Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full gates**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npx vitest run` — expected: full suite passes (including the 3 new test files).

- [ ] **Step 2: Manual visual verification (requires user approval to start the dev server)**

Ask the user before running `npm run dev`. Then at a 390×844 viewport (Chrome device toolbar), against the Zillow reference screenshots:

Mobile (`/browse`):
1. Header is 2 rows: red bar (logo · search field · hamburger) + pill row (Filters [badge] · radius chip when set · Save search). No "Browse Listings" banner.
2. Map fills the space between pill row and bottom tab bar; no page scroll.
3. Bottom tab bar: Browse active; Saved/Alerts navigate; Listings appears only for seller accounts; safe-area padding present.
4. Floating "List" pill bottom-center on map → tap switches to list view and URL gains `?view=list`; reload preserves list view.
5. List view: full-width cards with hearts; floating "Map | Sort" pill; Sort opens bottom sheet; picking a sort reorders and closes.
6. Heart tap toggles instantly without navigating; the listing appears/disappears on `/account/favorites`.
7. Layers FAB (bottom-right) opens the Map key bottom sheet; toggles hide/show map layers; no legend panel on mobile; no compass control.
8. Filters pill opens the full-screen sheet; every section applies live; "Clear all" resets; "Show results" closes; Escape/X/backdrop always close it.
9. Search in header: picking a city sets the radius circle, flips to map view.
10. Listing detail page (`/listings/<id>`): no tab bar (contact CTA bar only).

Desktop (≥ 1024px) regression:
11. `/browse` renders as before: two-tier red header with title/nav, FilterBar row, segmented List/Map toggle, radius slider, Save search, split view with legend panel — the only new element is the heart on cards.
12. Hamburger drawer (narrow desktop window / mobile) still locks scroll and closes on Escape.

- [ ] **Step 3: Fix anything found, re-run gates, commit fixes**

```bash
git add -A
git commit -m "fix(browse): mobile overhaul polish from visual verification"
```

(Skip if nothing found.)
