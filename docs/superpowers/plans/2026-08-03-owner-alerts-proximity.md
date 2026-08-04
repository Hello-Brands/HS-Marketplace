# Owner Closure Alerts, Watch-This-Area & Proximity Sort — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three features specced in `docs/superpowers/specs/2026-08-03-owner-alerts-proximity-design.md`: (1) competitor list sorted by proximity to the viewer's owned salons, (2) "Watch this area" radius searches around owned locations plus an explicit notify-scope step on all saved searches, (3) auto-created 3-mile owner closure alerts behind a one-time opt-in.

**Architecture:** Owner-auto alerts ARE saved-search rows (`alerts.origin = 'owner-auto'`) so the existing weekly cron, dedup ledger, Resend emails, and My Alerts UI are reused. A login-time reconciler mirrors opted-in users' owned salons into auto alerts. The proximity sort is a pure server-side annotate+sort over the already-fetched closure list.

**Tech Stack:** Next.js App Router (app in `src/`), Drizzle ORM + Neon HTTP driver, NextAuth v5, MapTiler SDK, nuqs, Resend, vitest, zod.

## Global Constraints

- **Three PRs, three branches**, each cut from **local `main`** (which is `origin/main` + the spec/plan doc commits): `feature/competitor-proximity-sort`, `feature/save-search-scope-watch-area`, `feature/owner-closure-alerts`. One PR each, scoped against `origin/main`.
- **Git identity:** only `sugarparker` can push to Hello-Brands/HS-Marketplace. On a 403, run `gh auth switch`.
- **Per-step gate is `npx tsc --noEmit`** (not `next build`). If you must build, stop any running dev server first (Windows `.next` lock). Lint is broken pre-existing — do not run it or try to fix it.
- **Never start `npm run dev` yourself.** Manual browser checks are optional steps for Parker.
- **DB:** `drizzle-kit generate` is broken (snapshot drift) and `db:push` is guarded — migrations are **hand-authored SQL + a `_journal.json` entry**. The Neon HTTP driver has **no `db.transaction`** — use `db.batch` or sequential writes.
- **`competitor_opportunities` and `monitored_brands` are scraper-owned and strictly read-only.** Never write to them, FK into them, or alter their columns.
- **No `import "server-only"` in pure/testable modules** (`src/lib/competitor-sort.ts`, `src/lib/owner-alerts/plan.ts`, `src/lib/owner-alerts/constants.ts`, `src/lib/save-search-validation.ts` must stay server-only-free).
- **Money is cents** everywhere (`minPrice`/`maxPrice`).
- **Constants:** `OWNER_AUTO_RADIUS_MILES = 3`, `WATCH_DEFAULT_RADIUS_MILES = 5`, radius slider bounds are the existing `RADIUS_MIN_MILES = 1` / `RADIUS_MAX_MILES = 100` from `src/components/browse/FilterBar.tsx:10-11`.
- **Tailwind palette is brand-remapped** — stock class names like `emerald`/`sky` are intentional elsewhere; don't "fix" them.
- Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; PR bodies end with the Claude Code attribution line.
- Run `npx vitest run` (full suite) before each PR; targeted files during tasks.

---

# Phase 1 — PR 1: Proximity-sorted competitor list

### Task 1: Pure sort/annotate function `competitor-sort.ts`

**Files:**
- Create: `src/lib/competitor-sort.ts`
- Test: `src/__tests__/competitor-sort.test.ts`

**Interfaces:**
- Consumes: `haversineMiles` from `src/lib/geo.ts:15`, `CompetitorClosure` from `src/lib/competitor-query.ts:15-30`.
- Produces: `annotateAndSortCompetitors(competitors, ctx)`, `toOwnerPoints(locations)`, types `OwnerPoint`, `AnnotatedCompetitor` (used by Task 2 and by `CompetitorList`).

- [ ] **Step 1: Create branch**

```bash
git checkout main && git pull origin main
git checkout -b feature/competitor-proximity-sort
```

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/competitor-sort.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  annotateAndSortCompetitors,
  toOwnerPoints,
} from "@/lib/competitor-sort"
import type { CompetitorClosure } from "@/lib/competitor-query"

function makeCompetitor(overrides: Partial<CompetitorClosure>): CompetitorClosure {
  return {
    googlePlaceId: "p1",
    brandId: "ewc",
    brandName: "European Wax Center",
    address: "1 Main St",
    city: "Salt Lake City",
    state: "UT",
    latitude: 40.76,
    longitude: -111.89,
    businessStatus: "CLOSED_PERMANENTLY",
    closedAt: null,
    nearestHsName: null,
    nearestHsMiles: null,
    isOpportunity: false,
    mapsUrl: null,
    ...overrides,
  }
}

// Sugar House SLC ≈ (40.7250, -111.8600); downtown SLC ≈ (40.7608, -111.8910)
const SUGAR_HOUSE = { name: "Sugar House", latitude: 40.725, longitude: -111.86 }
const PROVO = { name: "Provo", latitude: 40.2338, longitude: -111.6585 }

describe("annotateAndSortCompetitors", () => {
  it("sorts by distance to the nearest owned salon and annotates it", () => {
    const near = makeCompetitor({ googlePlaceId: "near", latitude: 40.73, longitude: -111.86 })
    const far = makeCompetitor({ googlePlaceId: "far", latitude: 41.5, longitude: -112.0 })
    const result = annotateAndSortCompetitors([far, near], {
      ownerPoints: [SUGAR_HOUSE, PROVO],
    })
    expect(result.map((c) => c.googlePlaceId)).toEqual(["near", "far"])
    expect(result[0].ownerDistanceFrom).toBe("Sugar House")
    expect(result[0].ownerDistanceMiles).toBeGreaterThan(0)
    expect(result[0].ownerDistanceMiles).toBeLessThan(2)
  })

  it("prefers the searched center over owned locations for ordering", () => {
    // Owned salon is near "a"; the searched center is near "b" → center wins.
    const a = makeCompetitor({ googlePlaceId: "a", latitude: 40.726, longitude: -111.861 })
    const b = makeCompetitor({ googlePlaceId: "b", latitude: 40.24, longitude: -111.66 })
    const result = annotateAndSortCompetitors([a, b], {
      searchCenter: { lat: 40.2338, lng: -111.6585 }, // Provo
      ownerPoints: [SUGAR_HOUSE],
    })
    expect(result.map((c) => c.googlePlaceId)).toEqual(["b", "a"])
    // Owner annotation still present even when the center drives the sort.
    expect(result.find((c) => c.googlePlaceId === "a")!.ownerDistanceFrom).toBe("Sugar House")
  })

  it("falls back to opportunities-first, then newest closedAt, for non-owners", () => {
    const oldOpp = makeCompetitor({ googlePlaceId: "oldOpp", isOpportunity: true, closedAt: "2026-01-01T00:00:00.000Z" })
    const newPlain = makeCompetitor({ googlePlaceId: "newPlain", closedAt: "2026-07-01T00:00:00.000Z" })
    const oldPlain = makeCompetitor({ googlePlaceId: "oldPlain", closedAt: "2026-02-01T00:00:00.000Z" })
    const nullPlain = makeCompetitor({ googlePlaceId: "nullPlain", closedAt: null })
    const result = annotateAndSortCompetitors([nullPlain, oldPlain, newPlain, oldOpp], {})
    expect(result.map((c) => c.googlePlaceId)).toEqual(["oldOpp", "newPlain", "oldPlain", "nullPlain"])
    expect(result[0].ownerDistanceMiles).toBeNull()
  })
})

describe("toOwnerPoints", () => {
  it("drops locations without coordinates", () => {
    const points = toOwnerPoints([
      { blvdLocationName: "Sugar House", latitude: 40.725, longitude: -111.86 },
      { blvdLocationName: "No Coords", latitude: null, longitude: null },
    ])
    expect(points).toEqual([{ name: "Sugar House", latitude: 40.725, longitude: -111.86 }])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/competitor-sort.test.ts`
Expected: FAIL — cannot resolve `@/lib/competitor-sort`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/competitor-sort.ts`:

```ts
import { haversineMiles } from "./geo"
import type { CompetitorClosure } from "./competitor-query"

/** A named coordinate for one of the viewer's owned salons. */
export interface OwnerPoint {
  name: string
  latitude: number
  longitude: number
}

/**
 * CompetitorClosure plus the distance to the viewer's nearest owned salon.
 * Fields are optional so plain CompetitorClosure[] remains assignable — client
 * components read them defensively.
 */
export type AnnotatedCompetitor = CompetitorClosure & {
  ownerDistanceMiles?: number | null
  ownerDistanceFrom?: string | null
}

export interface CompetitorSortContext {
  /** Active searched center (city + radius search); takes sort precedence. */
  searchCenter?: { lat: number; lng: number } | null
  /** The signed-in user's owned salons that have coordinates. */
  ownerPoints?: OwnerPoint[]
}

/** owner_locations rows → OwnerPoints, dropping un-geocoded rows. */
export function toOwnerPoints(
  locations: Array<{
    blvdLocationName: string
    latitude: number | null
    longitude: number | null
  }>
): OwnerPoint[] {
  return locations
    .filter((l) => l.latitude != null && l.longitude != null)
    .map((l) => ({
      name: l.blvdLocationName,
      latitude: l.latitude as number,
      longitude: l.longitude as number,
    }))
}

/**
 * Annotate each closure with the distance to the viewer's nearest owned salon,
 * then sort: searched center (when set) → nearest owned salon → opportunities
 * first + newest closure. Pure; the caller resolves session/owner data.
 */
export function annotateAndSortCompetitors(
  competitors: CompetitorClosure[],
  ctx: CompetitorSortContext
): AnnotatedCompetitor[] {
  const ownerPoints = ctx.ownerPoints ?? []

  const annotated: AnnotatedCompetitor[] = competitors.map((c) => {
    let best: { d: number; name: string } | null = null
    for (const p of ownerPoints) {
      const d = haversineMiles(p.latitude, p.longitude, c.latitude, c.longitude)
      if (best === null || d < best.d) best = { d, name: p.name }
    }
    return {
      ...c,
      ownerDistanceMiles: best ? best.d : null,
      ownerDistanceFrom: best ? best.name : null,
    }
  })

  const center = ctx.searchCenter
  if (center) {
    return annotated
      .map((c) => ({ c, d: haversineMiles(center.lat, center.lng, c.latitude, c.longitude) }))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.c)
  }

  if (ownerPoints.length > 0) {
    return [...annotated].sort(
      (a, b) => (a.ownerDistanceMiles ?? Infinity) - (b.ownerDistanceMiles ?? Infinity)
    )
  }

  const closedTime = (c: AnnotatedCompetitor) =>
    c.closedAt ? Date.parse(c.closedAt) : Number.NEGATIVE_INFINITY
  return [...annotated].sort((a, b) => {
    if (a.isOpportunity !== b.isOpportunity) return a.isOpportunity ? -1 : 1
    return closedTime(b) - closedTime(a)
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/competitor-sort.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Gate and commit**

```bash
npx tsc --noEmit
git add src/lib/competitor-sort.ts src/__tests__/competitor-sort.test.ts
git commit -m "feat(browse): pure annotate-and-sort for competitor proximity"
```

### Task 2: Wire the sort into the browse page and show the distance on cards

**Files:**
- Modify: `src/app/browse/page.tsx:62-114` (BrowseContent)
- Modify: `src/components/browse/CompetitorList.tsx:3-7` (prop type) and `:82-86` (distance line)

**Interfaces:**
- Consumes: `annotateAndSortCompetitors` / `toOwnerPoints` / `AnnotatedCompetitor` from Task 1; `getMyOwnerLocations()` from `src/lib/owner-directory/data.ts:21` (returns `{ ownerIdentifiers: string[]; locations: OwnerLocation[] }`, already session-scoped and revocation-safe).
- Produces: the `/browse` page passes an **annotated, pre-sorted** `competitorClosures` array down the existing prop chain (`BrowsePage` → `BrowseListContent` → `CompetitorList`); no prop names change.

- [ ] **Step 1: Annotate + sort in the server component**

In `src/app/browse/page.tsx`:

1. Add imports:

```ts
import { getMyOwnerLocations } from "@/lib/owner-directory/data"
import { annotateAndSortCompetitors, toOwnerPoints } from "@/lib/competitor-sort"
```

2. Add `getMyOwnerLocations()` as a 7th member of the existing `Promise.all` (line 72-90) and destructure it as `myOwnership`:

```ts
const [{ items: initialListings }, competitorClosures, savedCompetitorIds, hsLocations, mapOwnership, favoriteIds, myOwnership] =
  await Promise.all([
    getListings(filters),
    getCompetitorClosures({ ... unchanged ... }),
    getSavedCompetitorPlaceIds(),
    getUnlistedHsLocations({ ... unchanged ... }),
    getMyMapOwnership(),
    getFavoriteListingIds(),
    getMyOwnerLocations(),
  ])
```

3. After the `Promise.all`, compute the sorted list (privacy note: owner coords stay in this per-request page render — DEBT-024 forbids pushing them into the shared `unstable_cache`d queries):

```ts
// Sort competitors by the searched center, else by the viewer's nearest owned
// salon, else opportunities-first + newest. Per-request on purpose: owner
// coordinates must never enter the shared owner-agnostic caches (DEBT-024).
const sortedCompetitors = annotateAndSortCompetitors(competitorClosures, {
  searchCenter:
    filters.centerLat != null && filters.centerLng != null
      ? { lat: filters.centerLat, lng: filters.centerLng }
      : null,
  ownerPoints: toOwnerPoints(myOwnership.locations),
})
```

4. Pass `competitorClosures={sortedCompetitors}` to `<BrowsePage>` (line 106).

- [ ] **Step 2: Show the owner-distance line on the card**

In `src/components/browse/CompetitorList.tsx`:

1. Change the import and prop type (lines 3-7) so the card can read the annotation:

```ts
import type { AnnotatedCompetitor } from "@/lib/competitor-sort"
import { SaveCompetitorButton } from "./SaveCompetitorButton"

interface CompetitorListProps {
  competitors: AnnotatedCompetitor[]
  savedSet: Set<string>
  onToggleSave: (c: AnnotatedCompetitor) => void
  onSelect: (c: AnnotatedCompetitor) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}
```

(`AnnotatedCompetitor`'s extra fields are optional, so every existing caller
that passes `CompetitorClosure[]` still typechecks, and the callbacks remain
compatible with `BrowsePage`'s `(c: CompetitorClosure) => void` handlers.)

2. Replace the nearest-HS block (lines 82-86) with owner-distance-first display:

```tsx
{c.ownerDistanceMiles != null && c.ownerDistanceFrom ? (
  <p className="text-xs text-hs-taupe mt-1">
    ≈{c.ownerDistanceMiles.toFixed(1)} mi from {c.ownerDistanceFrom}
  </p>
) : c.nearestHsName && c.nearestHsMiles != null ? (
  <p className="text-xs text-hs-taupe mt-1">
    {c.nearestHsMiles.toFixed(1)} mi from {c.nearestHsName}
  </p>
) : null}
```

- [ ] **Step 3: Gate**

Run: `npx tsc --noEmit` — expect clean.
Run: `npx vitest run` — full suite, expect no regressions (the browse page has no direct tests; `radius-search-hint` and `geo` suites must stay green).

- [ ] **Step 4: Optional manual check (Parker runs the dev server)**

With a dev session signed in as a linked owner: `/browse` list view → Competitors block ordered nearest-first with "≈X.X mi from {salon}" lines; signed in as a non-owner → opportunities pinned to top, then newest.

- [ ] **Step 5: Commit**

```bash
git add src/app/browse/page.tsx src/components/browse/CompetitorList.tsx
git commit -m "feat(browse): sort competitor list by proximity to owned salons"
```

### Task 3: Open PR 1

- [ ] **Step 1: Full-suite gate**

Run: `npx tsc --noEmit && npx vitest run` — both clean.

- [ ] **Step 2: Push and create the PR**

```bash
git push -u origin feature/competitor-proximity-sort
gh pr create --base main --title "feat(browse): proximity-sorted competitor list" --body "<summary of Task 1-2, link the spec doc>"
```

(On a 403 push: `gh auth switch` to sugarparker and retry.) Note the PR includes the spec + plan docs since the branch was cut from local main — intended.

---

# Phase 2 — PR 2: Save-search scope step + Watch this area

### Task 4: Pure validation module + shared scope fields component

**Files:**
- Create: `src/lib/save-search-validation.ts`
- Create: `src/components/alerts/AlertScopeFields.tsx`
- Create: `src/components/alerts/AlertModal.tsx`
- Test: `src/__tests__/save-search-validation.test.ts`

**Interfaces:**
- Produces: `hasAnyRealFilter(f)`, `scopeSelected(s)`, `type AlertScope = { includeListings: boolean; includeCompetitors: boolean }` (Tasks 5-6); `<AlertScopeFields value onChange />` (Tasks 5-6); `<AlertModal open onClose title>{children}</AlertModal>` (Tasks 5-6).

- [ ] **Step 1: Create branch**

```bash
git checkout main
git checkout -b feature/save-search-scope-watch-area
```

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/save-search-validation.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { hasAnyRealFilter, scopeSelected } from "@/lib/save-search-validation"

describe("hasAnyRealFilter", () => {
  it("rejects an empty filter set (sort alone doesn't count)", () => {
    expect(hasAnyRealFilter({})).toBe(false)
  })
  it("accepts a full geo circle but not a partial one", () => {
    expect(hasAnyRealFilter({ centerLat: 40.7, centerLng: -111.9, radiusMiles: 5 })).toBe(true)
    expect(hasAnyRealFilter({ centerLat: 40.7, centerLng: -111.9 })).toBe(false)
  })
  it("accepts each scalar filter", () => {
    expect(hasAnyRealFilter({ query: "salon" })).toBe(true)
    expect(hasAnyRealFilter({ query: "   " })).toBe(false)
    expect(hasAnyRealFilter({ types: ["suite"] })).toBe(true)
    expect(hasAnyRealFilter({ states: ["UT"] })).toBe(true)
    expect(hasAnyRealFilter({ minPrice: 0 })).toBe(true)
    expect(hasAnyRealFilter({ maxPrice: 100_000_00 })).toBe(true)
    expect(hasAnyRealFilter({ minYearsOpen: 2 })).toBe(true)
    expect(hasAnyRealFilter({ minYearsOpen: 0 })).toBe(false)
    expect(hasAnyRealFilter({ inventoryIncluded: true })).toBe(true)
  })
})

describe("scopeSelected", () => {
  it("requires at least one channel", () => {
    expect(scopeSelected({ includeListings: false, includeCompetitors: false })).toBe(false)
    expect(scopeSelected({ includeListings: true, includeCompetitors: false })).toBe(true)
    expect(scopeSelected({ includeListings: false, includeCompetitors: true })).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/save-search-validation.test.ts`
Expected: FAIL — cannot resolve `@/lib/save-search-validation`.

- [ ] **Step 4: Implement the validation module**

Create `src/lib/save-search-validation.ts` (pure — no server-only, no React):

```ts
/** The filter fields that make a saved search non-empty. Mirrors SaveSearchInput. */
export interface SaveSearchFilterCheck {
  query?: string | null
  types?: string[]
  states?: string[]
  minPrice?: number | null
  maxPrice?: number | null
  minYearsOpen?: number | null
  inventoryIncluded?: boolean | null
  centerLat?: number | null
  centerLng?: number | null
  radiusMiles?: number | null
}

/**
 * Sort is ordering, not a filter — an empty save would create an "all listings"
 * alert that emails on every approved listing, so require at least one real
 * filter. (Moved out of SaveSearchButton so the watch dialog shares it.)
 */
export function hasAnyRealFilter(f: SaveSearchFilterCheck): boolean {
  return (
    !!(f.query && f.query.trim()) ||
    (f.types?.length ?? 0) > 0 ||
    (f.states?.length ?? 0) > 0 ||
    f.minPrice != null ||
    f.maxPrice != null ||
    (f.minYearsOpen != null && f.minYearsOpen > 0) ||
    f.inventoryIncluded === true ||
    (f.centerLat != null && f.centerLng != null && f.radiusMiles != null)
  )
}

/** What a saved search notifies about. */
export interface AlertScope {
  includeListings: boolean
  includeCompetitors: boolean
}

export function scopeSelected(s: AlertScope): boolean {
  return s.includeListings || s.includeCompetitors
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/save-search-validation.test.ts`
Expected: PASS.

- [ ] **Step 6: Create the shared scope fields + modal shell**

Create `src/components/alerts/AlertScopeFields.tsx`:

```tsx
"use client"

import type { AlertScope } from "@/lib/save-search-validation"

interface AlertScopeFieldsProps {
  value: AlertScope
  onChange: (next: AlertScope) => void
}

/**
 * The explicit "notify me about" choice shared by the save-search popover and
 * the watch-area dialog, so the two flows can't drift.
 */
export function AlertScopeFields({ value, onChange }: AlertScopeFieldsProps) {
  return (
    <fieldset>
      <legend className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
        Notify me about
      </legend>
      <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[36px] cursor-pointer">
        <input
          type="checkbox"
          checked={value.includeCompetitors}
          onChange={(e) => onChange({ ...value, includeCompetitors: e.target.checked })}
          className="w-4 h-4 accent-hs-red-600"
        />
        Competitor closures
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[36px] cursor-pointer">
        <input
          type="checkbox"
          checked={value.includeListings}
          onChange={(e) => onChange({ ...value, includeListings: e.target.checked })}
          className="w-4 h-4 accent-hs-red-600"
        />
        Hello Sugar listings for sale
      </label>
    </fieldset>
  )
}
```

Create `src/components/alerts/AlertModal.tsx` (small self-contained modal; bottom sheet on mobile, centered card on desktop — avoids the pill row's `overflow-x-auto` clipping an absolutely-positioned popover):

```tsx
"use client"

import type { ReactNode } from "react"

interface AlertModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function AlertModal({ open, onClose, title, children }: AlertModalProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Gate and commit**

```bash
npx tsc --noEmit
git add src/lib/save-search-validation.ts src/components/alerts/AlertScopeFields.tsx src/components/alerts/AlertModal.tsx src/__tests__/save-search-validation.test.ts
git commit -m "feat(alerts): shared notify-scope fields, modal shell, and save-search validation"
```

### Task 5: SaveSearchButton becomes a two-step flow with explicit scope

**Files:**
- Modify: `src/components/browse/SaveSearchButton.tsx` (full rewrite of the component body; `SaveSearchInput` type unchanged)

**Interfaces:**
- Consumes: `AlertScopeFields`, `AlertModal`, `hasAnyRealFilter`, `scopeSelected`, `AlertScope` from Task 4; `createAlert` from `src/lib/alert-actions.ts:107`.
- Produces: same external contract — `<SaveSearchButton filters={SaveSearchInput} />`; both call sites in `BrowsePage.tsx:308-325` and `:367-384` keep working unchanged (they already pass `includeListings`/`includeCompetitors` from the layer toggles, which now become the checkbox defaults).

- [ ] **Step 1: Rewrite the component**

Replace the body of `src/components/browse/SaveSearchButton.tsx` (keep the `SaveSearchInput` interface and `BellIcon` as-is):

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { createAlert } from "@/lib/alert-actions"
import { AlertScopeFields } from "@/components/alerts/AlertScopeFields"
import { AlertModal } from "@/components/alerts/AlertModal"
import { hasAnyRealFilter, scopeSelected, type AlertScope } from "@/lib/save-search-validation"

export interface SaveSearchInput {
  query?: string | null
  types?: string[]
  states?: string[]
  minPrice?: number | null
  maxPrice?: number | null
  minYearsOpen?: number | null
  inventoryIncluded?: boolean | null
  sort?: string | null
  centerLat?: number | null
  centerLng?: number | null
  radiusMiles?: number | null
  centerLabel?: string | null
  includeListings?: boolean
  includeCompetitors?: boolean
}

export function SaveSearchButton({ filters }: { filters: SaveSearchInput }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [scope, setScope] = useState<AlertScope>({ includeListings: true, includeCompetitors: true })

  function handleOpen() {
    if (!hasAnyRealFilter(filters)) {
      setError("Add at least one filter before saving a search.")
      return
    }
    setError(null)
    setName("")
    // Checkbox defaults come from the current map layer toggles — but now the
    // user SEES and confirms them instead of silently inheriting.
    setScope({
      includeListings: filters.includeListings ?? true,
      includeCompetitors: filters.includeCompetitors ?? true,
    })
    setOpen(true)
  }

  async function handleSave() {
    if (!scopeSelected(scope)) {
      setError("Pick at least one thing to be notified about.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await createAlert({
      name: name.trim() || undefined,
      query: filters.query || undefined,
      states: filters.states && filters.states.length > 0 ? filters.states : undefined,
      listingTypes: filters.types && filters.types.length > 0 ? filters.types : undefined,
      minPrice: filters.minPrice ?? undefined,
      maxPrice: filters.maxPrice ?? undefined,
      minYearsOpen: filters.minYearsOpen ?? undefined,
      inventoryIncluded: filters.inventoryIncluded || undefined,
      sort: filters.sort || undefined,
      centerLat: filters.centerLat ?? undefined,
      centerLng: filters.centerLng ?? undefined,
      radiusMiles: filters.radiusMiles ?? undefined,
      centerLabel: filters.centerLabel || undefined,
      includeListings: scope.includeListings,
      includeCompetitors: scope.includeCompetitors,
    })
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      setOpen(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleOpen}
        disabled={saving || saved}
        className={[
          "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2",
          saved ? "bg-green-100 text-green-800" : "bg-white border border-gray-300 hover:bg-gray-50 text-gray-700",
          saving || saved ? "opacity-75 cursor-not-allowed" : "",
        ].filter(Boolean).join(" ")}
      >
        {saving ? "Saving..." : saved ? "Saved!" : (<><BellIcon /> Save this search</>)}
      </button>
      {saved && (
        <Link href="/account/alerts" className="text-xs font-medium text-hs-red-600 hover:text-hs-red-700">
          View in My Alerts →
        </Link>
      )}
      {error && !open && <p className="text-xs text-hs-red-600">{error}</p>}

      <AlertModal open={open} onClose={() => setOpen(false)} title="Save this search">
        <div className="space-y-4">
          <AlertScopeFields value={scope} onChange={setScope} />
          <div>
            <label htmlFor="save-search-name" className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 block">
              Name <span className="font-normal normal-case">(optional)</span>
            </label>
            <input
              id="save-search-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Utah suites under $500k"
              maxLength={120}
              className="h-10 w-full rounded-lg border border-gray-300 px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
            />
          </div>
          {error && <p className="text-xs text-hs-red-600">{error}</p>}
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="min-h-[40px] px-3 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="min-h-[40px] px-4 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save search"}
            </button>
          </div>
        </div>
      </AlertModal>
    </div>
  )
}

function BellIcon() {
  /* unchanged from the current file */
}
```

- [ ] **Step 2: Gate**

Run: `npx tsc --noEmit && npx vitest run` — expect clean (no test imports this component directly today).

- [ ] **Step 3: Commit**

```bash
git add src/components/browse/SaveSearchButton.tsx
git commit -m "feat(alerts): explicit notify-scope step when saving a search"
```

### Task 6: Watch-area dialog + button on the location detail page

**Files:**
- Create: `src/components/alerts/WatchAreaDialog.tsx`
- Create: `src/components/alerts/WatchAreaButton.tsx`
- Modify: `src/app/account/locations/[id]/page.tsx:81-93` (badges row section)

**Interfaces:**
- Consumes: `AlertScopeFields`, `AlertModal`, `scopeSelected` (Task 4); `createAlert`; `RADIUS_MIN_MILES` / `RADIUS_MAX_MILES` from `src/components/browse/FilterBar.tsx:10-11`.
- Produces: `<WatchAreaDialog location onClose />` where `location: { name: string; latitude: number; longitude: number } | null` (null = closed) — reused by Task 7's map path; `<WatchAreaButton locationName latitude longitude />` for the detail page; `WATCH_DEFAULT_RADIUS_MILES = 5` exported from `WatchAreaDialog.tsx`.

- [ ] **Step 1: Create the dialog**

Create `src/components/alerts/WatchAreaDialog.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createAlert } from "@/lib/alert-actions"
import { AlertModal } from "./AlertModal"
import { AlertScopeFields } from "./AlertScopeFields"
import { scopeSelected, type AlertScope } from "@/lib/save-search-validation"
import { RADIUS_MIN_MILES, RADIUS_MAX_MILES } from "@/components/browse/FilterBar"

/** Default radius for a watch-this-area search around an owned salon. */
export const WATCH_DEFAULT_RADIUS_MILES = 5

export interface WatchAreaLocation {
  name: string
  latitude: number
  longitude: number
}

interface WatchAreaDialogProps {
  location: WatchAreaLocation | null
  onClose: () => void
}

/**
 * Save a radius search centered on one of the viewer's owned salons. Produces a
 * completely normal saved search (origin 'user'): deletable, editable, both
 * closure types, ledger-seeded by createAlert.
 */
export function WatchAreaDialog({ location, onClose }: WatchAreaDialogProps) {
  const [radius, setRadius] = useState(WATCH_DEFAULT_RADIUS_MILES)
  const [scope, setScope] = useState<AlertScope>({ includeListings: false, includeCompetitors: true })
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reset per location so a second open doesn't leak the previous salon's state.
  useEffect(() => {
    if (location) {
      setRadius(WATCH_DEFAULT_RADIUS_MILES)
      setScope({ includeListings: false, includeCompetitors: true })
      setName(`Near ${location.name}`)
      setSavedName(null)
      setError(null)
    }
  }, [location])

  if (!location && !savedName) return null

  async function handleSave() {
    if (!location) return
    if (!scopeSelected(scope)) {
      setError("Pick at least one thing to be notified about.")
      return
    }
    setSaving(true)
    setError(null)
    const result = await createAlert({
      name: name.trim() || `Near ${location.name}`,
      centerLat: location.latitude,
      centerLng: location.longitude,
      radiusMiles: radius,
      centerLabel: location.name,
      includeListings: scope.includeListings,
      includeCompetitors: scope.includeCompetitors,
    })
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      setSavedName(name.trim() || `Near ${location.name}`)
    }
  }

  // Success confirmation state (location may already be cleared by the parent).
  if (savedName) {
    return (
      <AlertModal open onClose={onClose} title="Search saved">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">{savedName}</span> is saved. We&apos;ll email you when
          something new appears in that area.
        </p>
        <div className="mt-4 flex items-center justify-end gap-3">
          <Link href="/account/alerts" className="text-sm font-medium text-hs-red-600 hover:text-hs-red-700">
            View in My Alerts →
          </Link>
          <button type="button" onClick={onClose} className="min-h-[40px] px-4 rounded-lg bg-gray-900 text-white text-sm font-semibold">
            Done
          </button>
        </div>
      </AlertModal>
    )
  }

  return (
    <AlertModal open onClose={onClose} title={`Watch the area around ${location!.name}`}>
      <div className="space-y-4">
        <div>
          <label htmlFor="watch-radius" className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 block">
            Radius
          </label>
          <div className="flex items-center gap-3">
            <input
              id="watch-radius"
              type="range"
              min={RADIUS_MIN_MILES}
              max={RADIUS_MAX_MILES}
              step={1}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="flex-1 h-2 cursor-pointer accent-hs-red-600"
            />
            <span className="text-sm font-medium text-gray-700 tabular-nums w-14">{radius} mi</span>
          </div>
        </div>
        <AlertScopeFields value={scope} onChange={setScope} />
        <div>
          <label htmlFor="watch-name" className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2 block">
            Name
          </label>
          <input
            id="watch-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className="h-10 w-full rounded-lg border border-gray-300 px-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
          />
        </div>
        {error && <p className="text-xs text-hs-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-[40px] px-3 text-sm text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[40px] px-4 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save search"}
          </button>
        </div>
      </div>
    </AlertModal>
  )
}
```

- [ ] **Step 2: Create the detail-page button**

Create `src/components/alerts/WatchAreaButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import { WatchAreaDialog } from "./WatchAreaDialog"

interface WatchAreaButtonProps {
  locationName: string
  latitude: number | null
  longitude: number | null
}

/** "Watch this area" entry point on /account/locations/[id]. Disabled (with an
 * explanation) for locations the directory hasn't geocoded yet. */
export function WatchAreaButton({ locationName, latitude, longitude }: WatchAreaButtonProps) {
  const [open, setOpen] = useState(false)
  const hasCoords = latitude != null && longitude != null

  return (
    <>
      <button
        type="button"
        onClick={() => hasCoords && setOpen(true)}
        disabled={!hasCoords}
        title={hasCoords ? undefined : "This location doesn't have map coordinates yet, so a radius search can't be centered on it."}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        Watch this area
      </button>
      <WatchAreaDialog
        location={open && hasCoords ? { name: locationName, latitude: latitude as number, longitude: longitude as number } : null}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
```

- [ ] **Step 3: Place the button on the detail page**

In `src/app/account/locations/[id]/page.tsx`, import it and add it to the badges row (after the `openedSince` span inside the `flex flex-wrap items-center gap-2 mt-4 pt-4 border-t` div, lines 81-93), pushed to the right:

```tsx
import { WatchAreaButton } from "@/components/alerts/WatchAreaButton"
```

```tsx
<div className="ml-auto">
  <WatchAreaButton
    locationName={loc.blvdLocationName}
    latitude={loc.latitude}
    longitude={loc.longitude}
  />
</div>
```

- [ ] **Step 4: Gate and commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/components/alerts/WatchAreaDialog.tsx src/components/alerts/WatchAreaButton.tsx "src/app/account/locations/[id]/page.tsx"
git commit -m "feat(alerts): watch-this-area radius search from the location detail page"
```

### Task 7: Watch-area from the map popup (owned dots)

**Files:**
- Modify: `src/components/browse/hs-location-popup.ts:30-41` (owned CTA → two buttons)
- Modify: `src/components/browse/MapView.tsx` — props (`:29-37` area and defaults `:240-243`), ref block (`:268-269`), HS-dot effect (`:604-628`)
- Modify: `src/components/browse/BrowsePage.tsx` — dialog state + `onWatchArea` prop

**Interfaces:**
- Consumes: `WatchAreaDialog` + `WatchAreaLocation` (Task 6); `UnlistedHsLocation` from `src/lib/hs-locations-filter.ts:26-34` (has `id`, `name`, `latitude`, `longitude`).
- Produces: `MapView` gains optional prop `onWatchArea?: (loc: UnlistedHsLocation) => void`. Owned-dot click now pins the popup (was: navigate); popup buttons carry `data-hs-popup-action="view" | "watch"`.

- [ ] **Step 1: Two action buttons in the owned popup HTML**

In `src/components/browse/hs-location-popup.ts`, replace the `cta` constant (lines 30-32) with:

```ts
const cta = owned
  ? `<div style="margin-top:10px;display:flex;gap:8px;">
      <button type="button" data-hs-popup-action="view" style="flex:1;font-family:inherit;font-size:12px;font-weight:600;color:#3F7D5B;background:#fff;border:1px solid #DBEBE1;border-radius:8px;padding:6px 8px;cursor:pointer;">View location</button>
      <button type="button" data-hs-popup-action="watch" style="flex:1;font-family:inherit;font-size:12px;font-weight:600;color:#fff;background:#3F7D5B;border:none;border-radius:8px;padding:6px 8px;cursor:pointer;">Watch this area</button>
    </div>`
  : ""
```

- [ ] **Step 2: MapView — new prop and popup button wiring**

In `src/components/browse/MapView.tsx`:

1. Add to `MapViewProps` (near `onHsLocationClick`): `onWatchArea?: (loc: UnlistedHsLocation) => void`, destructure it in the component signature with the other optional props.
2. Add the ref next to `onHsLocationClickRef` (lines 268-269):

```ts
const onWatchAreaRef = useRef(onWatchArea)
onWatchAreaRef.current = onWatchArea
```

3. In the HS-dot effect, replace the click handler block (lines 613-625) so owned dots pin the popup like everyone else's (buttons carry the actions now):

```ts
// All HS dots pin the popup on click; owned popups carry View/Watch action
// buttons (wired below). stopPropagation keeps the map's closeOnClick from
// immediately dismissing a pinned popup.
el.addEventListener("click", (e) => {
  e.stopPropagation()
  pinned = true
  popup.addTo(m)
})
```

4. After the `popup.on("close", ...)` handler (line 626-628), wire the buttons using the same `popup.on("open")` + `dataset.bound` pattern the competitor save button uses (`MapView.tsx:529-539`):

```ts
if (isMine) {
  popup.on("open", () => {
    const root = popup.getElement()
    const viewBtn = root?.querySelector<HTMLButtonElement>('[data-hs-popup-action="view"]')
    if (viewBtn && viewBtn.dataset.bound !== "1") {
      viewBtn.dataset.bound = "1"
      viewBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        popup.remove()
        onHsLocationClickRef.current?.(loc.id)
      })
    }
    const watchBtn = root?.querySelector<HTMLButtonElement>('[data-hs-popup-action="watch"]')
    if (watchBtn && watchBtn.dataset.bound !== "1") {
      watchBtn.dataset.bound = "1"
      watchBtn.addEventListener("click", (e) => {
        e.stopPropagation()
        popup.remove()
        onWatchAreaRef.current?.(loc)
      })
    }
  })
}
```

(Check whether `onHsLocationClick` is typed optional with a `?.` call already — it is called via `onHsLocationClickRef.current` guarded by `if (isMine && ...)` today; the `?.` above keeps that safety.)

- [ ] **Step 3: BrowsePage — dialog state**

In `src/components/browse/BrowsePage.tsx`:

1. Imports:

```ts
import { WatchAreaDialog, type WatchAreaLocation } from "@/components/alerts/WatchAreaDialog"
```

2. State + handler near the other handlers (`useCallback` like `handleHsLocationClick`, lines 155-160):

```ts
const [watchLocation, setWatchLocation] = useState<WatchAreaLocation | null>(null)
const handleWatchArea = useCallback((loc: UnlistedHsLocation) => {
  setWatchLocation({ name: loc.name, latitude: loc.latitude, longitude: loc.longitude })
}, [])
```

(`UnlistedHsLocation` is already imported at line 16.)

3. Pass `onWatchArea={handleWatchArea}` to `<MapView>` (props block at lines 445-464).
4. Render the dialog just before `</main>` (after the sort BottomSheet, line 523):

```tsx
<WatchAreaDialog location={watchLocation} onClose={() => setWatchLocation(null)} />
```

- [ ] **Step 4: Gate**

Run: `npx tsc --noEmit && npx vitest run` — clean.

- [ ] **Step 5: Optional manual check (Parker runs the dev server)**

Map view as a linked owner: hover an owned dot → popup previews; click → popup pins with View/Watch buttons; Watch → dialog with 5-mi default and competitors-only pre-checked; save → appears in `/account/alerts` named "Near {salon}"; non-owned dots unchanged. Desktop save-search button → modal with scope checkboxes.

- [ ] **Step 6: Commit**

```bash
git add src/components/browse/hs-location-popup.ts src/components/browse/MapView.tsx src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): watch-this-area action on owned map dots"
```

### Task 8: Open PR 2

- [ ] **Step 1: Full-suite gate** — `npx tsc --noEmit && npx vitest run`, both clean.
- [ ] **Step 2: Push and create the PR**

```bash
git push -u origin feature/save-search-scope-watch-area
gh pr create --base main --title "feat(alerts): notify-scope step + watch-this-area searches" --body "<summary of Tasks 4-7, link the spec doc>"
```

---

# Phase 3 — PR 3: Automatic owner closure alerts

### Task 9: Verify live schema, hand-author migration 0009, update Drizzle schema

**Files:**
- Create: `drizzle/0009_owner_auto_alerts.sql`
- Modify: `drizzle/meta/_journal.json` (append idx 9)
- Modify: `src/db/schema/alerts.ts:24-26` (new columns before `notifyEnabled`)
- Modify: `src/db/schema/auth.ts:5-25` (users table)
- Scratchpad: a throwaway verify script (do NOT commit it)

**Interfaces:**
- Produces: `alerts.origin` (`'user' | 'owner-auto'`, default `'user'`, NOT NULL), `alerts.ownerIdentifier`, `alerts.ownerLocationName` (nullable text soft refs), `users.ownerAlertsChoice` (`'enabled' | 'declined' | null`). Every later task depends on these exact names.

- [ ] **Step 1: Create branch**

```bash
git checkout main
git checkout -b feature/owner-closure-alerts
```

- [ ] **Step 2: Verify the live Neon schema BEFORE authoring the migration**

Known drift: prod's `alerts` shape came from `db:push` and is not fully recorded in migrations, so confirm reality first. Write a throwaway script in the scratchpad directory (NOT the repo):

```ts
// <scratchpad>/verify-alerts-schema.ts
import { neon } from "@neondatabase/serverless"
const sql = neon(process.env.DATABASE_URL!)
const rows = await sql`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_name IN ('alerts', 'users', 'competitor_alert_log')
  ORDER BY table_name, ordinal_position`
console.log(rows)
```

Run it with `DATABASE_URL` exported from the main checkout's gitignored `.env.local` (Git Bash):

```bash
export DATABASE_URL='<value from .env.local>'
npx tsx <scratchpad>/verify-alerts-schema.ts
```

**Expected:** `alerts` has all 20 columns from `src/db/schema/alerts.ts` (incl. `center_lat`, `notify_enabled`, `include_listings`, `include_competitors`) and does **NOT** have `origin` / `owner_identifier` / `owner_location_name`; `users` does **NOT** have `owner_alerts_choice`; `competitor_alert_log` exists with `alert_id`, `google_place_id`, `alerted_at`. **STOP and report to Parker if anything differs** — the migration below assumes exactly this state.

- [ ] **Step 3: Author the migration**

Create `drizzle/0009_owner_auto_alerts.sql`:

```sql
ALTER TABLE "alerts" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;
ALTER TABLE "alerts" ADD COLUMN "owner_identifier" text;
ALTER TABLE "alerts" ADD COLUMN "owner_location_name" text;
ALTER TABLE "users" ADD COLUMN "owner_alerts_choice" text;
```

Append to `drizzle/meta/_journal.json` entries (after idx 8):

```json
{
  "idx": 9,
  "version": "7",
  "when": 1786060800000,
  "tag": "0009_owner_auto_alerts",
  "breakpoints": true
}
```

Run: `npx vitest run src/__tests__/db/migration-artifacts.test.ts` — expect PASS (journal↔sql consistency).

- [ ] **Step 4: Update the Drizzle schema**

In `src/db/schema/alerts.ts`, after `centerLabel` (line 24) add:

```ts
// Provenance: 'user' = saved manually from browse / watch-area; 'owner-auto' =
// created by the opt-in reconciler around an owned salon (3-mile default,
// permanent closures only in the cron, no delete button in My Alerts).
origin: text("origin", { enum: ["user", "owner-auto"] }).default("user").notNull(),
// Soft reference to owner_locations (owner_identifier + blvd_location_name).
// NOT an FK: that table full-refresh syncs and its row ids churn — same
// precedent as user_owner_links. Set only when origin = 'owner-auto'.
ownerIdentifier: text("owner_identifier"),
ownerLocationName: text("owner_location_name"),
```

In `src/db/schema/auth.ts`, after `ownerLinkSource` (line 22) add:

```ts
// Owner closure alerts one-time prompt: null = never asked; 'enabled' also
// means the login reconciler maintains this user's owner-auto alerts.
ownerAlertsChoice: text("owner_alerts_choice", { enum: ["enabled", "declined"] }),
```

**Do NOT add the new columns to `ALERT_FIELDS` in `src/lib/alert-actions.ts`** — they must never be settable through the public create/update actions.

- [ ] **Step 5: Apply the migration to the database**

Prod's drizzle migrations table already records 0000–0008, so migrate applies only 0009 (the known "fresh db:migrate fails at 0008" problem is empty-database-only). With env from `.env.local` (the `db:migrate` script — check `package.json` for the exact name; it needs `DATABASE_URL_DIRECT`):

```bash
export DATABASE_URL_DIRECT='<value from .env.local>'
npm run db:migrate
```

Re-run the Step 2 verify script: expect the four new columns present. If `db:migrate` errors on already-applied history, STOP and report — do not hand-run partial SQL without Parker.

- [ ] **Step 6: Gate and commit**

```bash
npx tsc --noEmit && npx vitest run
git add drizzle/0009_owner_auto_alerts.sql drizzle/meta/_journal.json src/db/schema/alerts.ts src/db/schema/auth.ts
git commit -m "feat(alerts): schema for owner-auto alerts and opt-in choice (migration 0009)"
```

(If the full suite has fixtures typed as `Alert` that now miss `origin`, add `origin: "user"` to those fixtures in this commit.)

### Task 10: Constants + pure reconcile planner

**Files:**
- Create: `src/lib/owner-alerts/constants.ts`
- Create: `src/lib/owner-alerts/plan.ts`
- Test: `src/__tests__/owner-alerts/plan.test.ts`

**Interfaces:**
- Produces: `OWNER_AUTO_RADIUS_MILES = 3`, `OWNER_AUTO_ORIGIN = "owner-auto"`, `isOwnerAutoAlert(a)` (constants.ts — server-only-free, safe for client components and scripts); `planOwnerAutoAlerts(owned, existing): OwnerAlertPlan` with types `OwnedLocationInput`, `OwnerAutoAlertInput`, `OwnerAlertPlan` (plan.ts). Tasks 11-14 consume these.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/owner-alerts/plan.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { planOwnerAutoAlerts } from "@/lib/owner-alerts/plan"

const loc = (ownerIdentifier: string, locationName: string, latitude: number | null, longitude: number | null) => ({
  ownerIdentifier, locationName, latitude, longitude,
})
const alertRow = (id: string, ownerIdentifier: string | null, ownerLocationName: string | null, centerLat: number | null, centerLng: number | null) => ({
  id, ownerIdentifier, ownerLocationName, centerLat, centerLng,
})

describe("planOwnerAutoAlerts", () => {
  it("creates alerts only for owned locations that have coordinates", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.725, -111.86), loc("own1", "No Coords", null, null)],
      []
    )
    expect(plan.toCreate).toEqual([
      { ownerIdentifier: "own1", locationName: "Sugar House", latitude: 40.725, longitude: -111.86 },
    ])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toDelete).toEqual([])
  })

  it("is a no-op when the alert already matches", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.725, -111.86)],
      [alertRow("a1", "own1", "Sugar House", 40.725, -111.86)]
    )
    expect(plan).toEqual({ toCreate: [], toUpdate: [], toDelete: [] })
  })

  it("refreshes drifted coordinates", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.9, -111.9)],
      [alertRow("a1", "own1", "Sugar House", 40.725, -111.86)]
    )
    expect(plan.toUpdate).toEqual([
      { id: "a1", latitude: 40.9, longitude: -111.9, locationName: "Sugar House" },
    ])
  })

  it("keeps the old center when a location LOSES its coordinates", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", null, null)],
      [alertRow("a1", "own1", "Sugar House", 40.725, -111.86)]
    )
    expect(plan).toEqual({ toCreate: [], toUpdate: [], toDelete: [] })
  })

  it("deletes alerts for locations the user no longer owns (revocation)", () => {
    const plan = planOwnerAutoAlerts([], [alertRow("a1", "own1", "Sugar House", 40.725, -111.86)])
    expect(plan.toDelete).toEqual(["a1"])
  })

  it("deletes malformed owner-auto rows missing their soft reference", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.725, -111.86)],
      [alertRow("bad", null, null, 40.0, -111.0), alertRow("a1", "own1", "Sugar House", 40.725, -111.86)]
    )
    expect(plan.toDelete).toEqual(["bad"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/owner-alerts/plan.test.ts`
Expected: FAIL — cannot resolve `@/lib/owner-alerts/plan`.

- [ ] **Step 3: Implement constants and planner**

Create `src/lib/owner-alerts/constants.ts`:

```ts
/**
 * Owner closure alerts: constants shared by server code, client components,
 * and tests. MUST stay free of "server-only" imports.
 */

/** Default radius for auto-created owner closure alerts (spec: 3 miles). */
export const OWNER_AUTO_RADIUS_MILES = 3

export const OWNER_AUTO_ORIGIN = "owner-auto" as const

/** True for saved searches created and managed by the owner-alert reconciler. */
export function isOwnerAutoAlert(a: { origin: string | null | undefined }): boolean {
  return a.origin === OWNER_AUTO_ORIGIN
}
```

Create `src/lib/owner-alerts/plan.ts`:

```ts
/**
 * Pure planning for the owner-auto alert reconciler: given the user's owned
 * salons and their existing owner-auto alerts, decide creates/updates/deletes.
 * Keyed on the (owner_identifier, blvd_location_name) soft reference — the
 * owner_locations table full-refresh syncs, so row ids are NOT stable.
 * Server-only-free so it unit-tests without mocks.
 */

export interface OwnedLocationInput {
  ownerIdentifier: string
  locationName: string // owner_locations.blvd_location_name
  latitude: number | null
  longitude: number | null
}

export interface OwnerAutoAlertInput {
  id: string
  ownerIdentifier: string | null
  ownerLocationName: string | null
  centerLat: number | null
  centerLng: number | null
}

export interface OwnerAlertPlan {
  toCreate: Array<{ ownerIdentifier: string; locationName: string; latitude: number; longitude: number }>
  toUpdate: Array<{ id: string; latitude: number; longitude: number; locationName: string }>
  toDelete: string[]
}

const pairKey = (ownerIdentifier: string, locationName: string) =>
  `${ownerIdentifier} ${locationName}`

export function planOwnerAutoAlerts(
  owned: OwnedLocationInput[],
  existing: OwnerAutoAlertInput[]
): OwnerAlertPlan {
  const ownedByKey = new Map<string, OwnedLocationInput>()
  for (const loc of owned) ownedByKey.set(pairKey(loc.ownerIdentifier, loc.locationName), loc)

  const toCreate: OwnerAlertPlan["toCreate"] = []
  const toUpdate: OwnerAlertPlan["toUpdate"] = []
  const toDelete: string[] = []

  const existingByKey = new Map<string, OwnerAutoAlertInput>()
  for (const a of existing) {
    // A malformed row (soft reference lost) can't be reconciled — remove it.
    if (!a.ownerIdentifier || !a.ownerLocationName) {
      toDelete.push(a.id)
      continue
    }
    const k = pairKey(a.ownerIdentifier, a.ownerLocationName)
    if (!ownedByKey.has(k)) {
      toDelete.push(a.id) // no longer effectively owned (revoked / removed)
      continue
    }
    existingByKey.set(k, a)
  }

  for (const [k, loc] of ownedByKey) {
    const ex = existingByKey.get(k)
    if (!ex) {
      // Un-geocoded locations are skipped; the reconciler picks them up once
      // the directory geocodes them.
      if (loc.latitude != null && loc.longitude != null) {
        toCreate.push({
          ownerIdentifier: loc.ownerIdentifier,
          locationName: loc.locationName,
          latitude: loc.latitude,
          longitude: loc.longitude,
        })
      }
      continue
    }
    // Refresh drifted coords. A location that LOST its coords keeps the old
    // (still valid) center rather than being deleted.
    if (
      loc.latitude != null &&
      loc.longitude != null &&
      (ex.centerLat !== loc.latitude || ex.centerLng !== loc.longitude)
    ) {
      toUpdate.push({ id: ex.id, latitude: loc.latitude, longitude: loc.longitude, locationName: loc.locationName })
    }
  }

  return { toCreate, toUpdate, toDelete }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/owner-alerts/plan.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Gate and commit**

```bash
npx tsc --noEmit
git add src/lib/owner-alerts/constants.ts src/lib/owner-alerts/plan.ts src/__tests__/owner-alerts/plan.test.ts
git commit -m "feat(alerts): owner-auto alert constants and pure reconcile planner"
```

### Task 11: Ledger-seeding extraction + reconciler + login wiring

**Files:**
- Modify: `src/lib/competitor-alert-log.ts` (add `seedCompetitorLedger`)
- Modify: `src/lib/alert-actions.ts:93-105` (delete local `seedCompetitorLog`, import the shared one; call sites `:119-126` and `:155-162` renamed)
- Create: `src/lib/owner-alerts/reconcile.ts`
- Modify: `src/auth.ts:69-79` (signIn event)
- Test: `src/__tests__/owner-alerts/reconcile.test.ts`

**Interfaces:**
- Consumes: `planOwnerAutoAlerts` (Task 10), `getEffectiveOwnerIdentifiers` from `src/lib/owner-directory/links.ts:29`, `UNKNOWN_OWNER` from `src/lib/owner-directory/query.ts`, `OWNER_AUTO_RADIUS_MILES`.
- Produces: `seedCompetitorLedger(alertId, scope)` exported from `src/lib/competitor-alert-log.ts` (used by alert-actions and the reconciler); `reconcileOwnerAutoAlerts(userId): Promise<void>` — never throws (Tasks 12 wiring).

- [ ] **Step 1: Extract the seeding helper**

In `src/lib/competitor-alert-log.ts`, add imports and the function (the file already has `import "server-only"`):

```ts
import { getCompetitorClosures } from "./competitor-query"
import { scopeIsBounded, type CompetitorScope } from "./competitor-filter"

/**
 * Baseline-seed a saved search's ledger with every closure currently in scope,
 * WITHOUT emailing — so the first weekly run never blasts pre-existing
 * closures. No-op when the scope can't narrow competitors.
 */
export async function seedCompetitorLedger(alertId: string, scope: CompetitorScope): Promise<void> {
  if (!scopeIsBounded(scope)) return
  const inScope = await getCompetitorClosures(scope)
  await recordCompetitorAlerts(alertId, inScope.map((c) => c.googlePlaceId))
}
```

In `src/lib/alert-actions.ts`: delete the local `seedCompetitorLog` (lines 93-105), remove the now-unused `getCompetitorClosures` / `scopeIsBounded` / `recordCompetitorAlerts` imports, add `import { seedCompetitorLedger } from "@/lib/competitor-alert-log"`, and rename both call sites (`createAlert` line 120, `updateAlert` line 156) to `seedCompetitorLedger` — the argument shapes already fit `CompetitorScope`.

Run: `npx vitest run src/__tests__/alert-actions.test.ts` — expect PASS unchanged (behavior identical; if the test file mocks the removed imports, update the mock paths to `@/lib/competitor-alert-log`).

- [ ] **Step 2: Write the failing reconciler test**

Create `src/__tests__/owner-alerts/reconcile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const findFirst = vi.fn()
const select = vi.fn()
vi.mock("@/db", () => ({
  db: {
    query: { users: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    select: (...a: unknown[]) => select(...a),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))
vi.mock("@/lib/owner-directory/links", () => ({
  getEffectiveOwnerIdentifiers: vi.fn(async () => []),
}))
vi.mock("@/lib/competitor-alert-log", () => ({
  seedCompetitorLedger: vi.fn(async () => {}),
}))

import { reconcileOwnerAutoAlerts } from "@/lib/owner-alerts/reconcile"

describe("reconcileOwnerAutoAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("does nothing unless the user opted in", async () => {
    findFirst.mockResolvedValue({ ownerAlertsChoice: null })
    await reconcileOwnerAutoAlerts("u1")
    expect(select).not.toHaveBeenCalled()
  })

  it("does nothing for a declined user", async () => {
    findFirst.mockResolvedValue({ ownerAlertsChoice: "declined" })
    await reconcileOwnerAutoAlerts("u1")
    expect(select).not.toHaveBeenCalled()
  })

  it("never throws (login must not break)", async () => {
    findFirst.mockRejectedValue(new Error("db down"))
    await expect(reconcileOwnerAutoAlerts("u1")).resolves.toBeUndefined()
  })
})
```

Run: `npx vitest run src/__tests__/owner-alerts/reconcile.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement the reconciler**

Create `src/lib/owner-alerts/reconcile.ts`:

```ts
import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { alerts } from "@/db/schema/alerts"
import { users } from "@/db/schema/auth"
import { ownerLocations } from "@/db/schema"
import { getEffectiveOwnerIdentifiers } from "@/lib/owner-directory/links"
import { UNKNOWN_OWNER } from "@/lib/owner-directory/query"
import { seedCompetitorLedger } from "@/lib/competitor-alert-log"
import { planOwnerAutoAlerts } from "./plan"
import { OWNER_AUTO_RADIUS_MILES, OWNER_AUTO_ORIGIN } from "./constants"

/**
 * Mirror an opted-in user's owned salons into origin='owner-auto' saved
 * searches: create (ledger-seeded) for newly owned, refresh drifted coords,
 * delete for no-longer-owned. Runs in the login event and the opt-in action.
 * Never throws — a directory or DB hiccup must not block sign-in (same
 * contract as linkOwnerAtLogin).
 */
export async function reconcileOwnerAutoAlerts(userId: string): Promise<void> {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (user?.ownerAlertsChoice !== "enabled") return

    const identifiers = (await getEffectiveOwnerIdentifiers(userId)).filter(
      (o) => o !== UNKNOWN_OWNER
    )

    const owned =
      identifiers.length === 0
        ? []
        : await db
            .select({
              ownerIdentifier: ownerLocations.ownerIdentifier,
              locationName: ownerLocations.blvdLocationName,
              latitude: ownerLocations.latitude,
              longitude: ownerLocations.longitude,
            })
            .from(ownerLocations)
            .where(inArray(ownerLocations.ownerIdentifier, identifiers))

    const existing = await db
      .select({
        id: alerts.id,
        ownerIdentifier: alerts.ownerIdentifier,
        ownerLocationName: alerts.ownerLocationName,
        centerLat: alerts.centerLat,
        centerLng: alerts.centerLng,
      })
      .from(alerts)
      .where(and(eq(alerts.userId, userId), eq(alerts.origin, OWNER_AUTO_ORIGIN)))

    const plan = planOwnerAutoAlerts(owned, existing)

    for (const c of plan.toCreate) {
      const [row] = await db
        .insert(alerts)
        .values({
          userId,
          origin: OWNER_AUTO_ORIGIN,
          ownerIdentifier: c.ownerIdentifier,
          ownerLocationName: c.locationName,
          name: c.locationName,
          centerLat: c.latitude,
          centerLng: c.longitude,
          radiusMiles: OWNER_AUTO_RADIUS_MILES,
          centerLabel: c.locationName,
          includeListings: false,
          includeCompetitors: true,
        })
        .returning({ id: alerts.id })
      // Seed so closures that pre-date the opt-in never email.
      await seedCompetitorLedger(row.id, {
        centerLat: c.latitude,
        centerLng: c.longitude,
        radiusMiles: OWNER_AUTO_RADIUS_MILES,
        states: [],
      })
    }

    for (const u of plan.toUpdate) {
      // Coords + label only — never touch `name` (the user may have renamed it)
      // or `notifyEnabled` (their kill switch).
      await db
        .update(alerts)
        .set({ centerLat: u.latitude, centerLng: u.longitude, centerLabel: u.locationName })
        .where(eq(alerts.id, u.id))
    }

    if (plan.toDelete.length > 0) {
      // competitor_alert_log rows cascade with the alert.
      await db.delete(alerts).where(inArray(alerts.id, plan.toDelete))
    }
  } catch (err) {
    console.warn("[owner-alerts] reconcile failed (non-fatal):", err)
  }
}
```

Run: `npx vitest run src/__tests__/owner-alerts/reconcile.test.ts` — expect PASS.

- [ ] **Step 4: Wire into the login event**

In `src/auth.ts`, import `reconcileOwnerAutoAlerts` and call it right after `linkOwnerAtLogin` in the `events.signIn` handler (line 71), so freshly reconciled links feed the alert reconcile:

```ts
async signIn({ user }) {
  if (user.id) {
    await linkOwnerAtLogin(user.id, user.email)
    await reconcileOwnerAutoAlerts(user.id) // never throws
    try {
      await recordLogin(user.id)
    } catch (err) {
      console.error("recordLogin failed", err)
    }
  }
},
```

- [ ] **Step 5: Gate and commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/lib/competitor-alert-log.ts src/lib/alert-actions.ts src/lib/owner-alerts/reconcile.ts src/auth.ts src/__tests__/owner-alerts/reconcile.test.ts
git commit -m "feat(alerts): owner-auto alert reconciler wired into login"
```

### Task 12: Opt-in server action + prompt banner on browse and My Alerts

**Files:**
- Create: `src/lib/owner-alerts/actions.ts`
- Create: `src/lib/owner-alerts/prompt.ts`
- Create: `src/components/alerts/OwnerAlertsPrompt.tsx`
- Modify: `src/app/account/alerts/page.tsx:7-29`
- Modify: `src/app/browse/page.tsx` (BrowseContent)

**Interfaces:**
- Consumes: `reconcileOwnerAutoAlerts` (Task 11).
- Produces: server action `chooseOwnerAlerts(choice: "enabled" | "declined"): Promise<{ error?: string; success?: boolean }>`; `shouldShowOwnerAlertsPrompt(): Promise<boolean>` (server-only); `<OwnerAlertsPrompt />` client banner.

- [ ] **Step 1: Server action (with its own auth — every "use server" export is a public POST)**

Create `src/lib/owner-alerts/actions.ts`:

```ts
"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { reconcileOwnerAutoAlerts } from "./reconcile"

/**
 * One-time owner closure-alerts choice. Enabling immediately creates the
 * 3-mile owner-auto searches via the reconciler.
 */
export async function chooseOwnerAlerts(choice: "enabled" | "declined") {
  const session = await auth()
  if (!session?.user?.id) return { error: "Not authenticated" }
  if (choice !== "enabled" && choice !== "declined") return { error: "Invalid choice" }

  await db.update(users).set({ ownerAlertsChoice: choice }).where(eq(users.id, session.user.id))
  if (choice === "enabled") await reconcileOwnerAutoAlerts(session.user.id)

  revalidatePath("/account/alerts")
  revalidatePath("/browse")
  return { success: true }
}
```

- [ ] **Step 2: Visibility helper**

Create `src/lib/owner-alerts/prompt.ts`:

```ts
import "server-only"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/db"
import { users } from "@/db/schema/auth"

/**
 * Show the one-time prompt only to users who hold ≥1 effective owner link and
 * have never answered. Resilient: any failure hides the prompt.
 */
export async function shouldShowOwnerAlertsPrompt(): Promise<boolean> {
  try {
    const session = await auth()
    if (!session?.user?.id) return false
    if ((session.user.ownerIdentifiers?.length ?? 0) === 0) return false
    const row = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { ownerAlertsChoice: true },
    })
    return row?.ownerAlertsChoice == null
  } catch (err) {
    console.warn("[owner-alerts] prompt visibility check failed:", err)
    return false
  }
}
```

- [ ] **Step 3: Prompt component**

Create `src/components/alerts/OwnerAlertsPrompt.tsx`:

```tsx
"use client"

import { useState } from "react"
import { chooseOwnerAlerts } from "@/lib/owner-alerts/actions"

/**
 * One-time opt-in banner for owner closure alerts. Server code decides whether
 * to render it (shouldShowOwnerAlertsPrompt); either answer stamps the choice
 * and it never reappears.
 */
export function OwnerAlertsPrompt() {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<"enabled" | "declined" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(choice: "enabled" | "declined") {
    setBusy(true)
    setError(null)
    const result = await chooseOwnerAlerts(choice)
    setBusy(false)
    if (result.error) setError(result.error)
    else setDone(choice)
  }

  if (done === "declined") return null
  if (done === "enabled") {
    return (
      <div role="status" className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        Closure alerts are on. We&apos;ll email you when a competitor within 3 miles of one of
        your salons closes permanently — manage them under My Alerts.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-hs-red-200 bg-hs-red-50 p-4">
      <p className="text-sm font-semibold text-gray-900">
        Get notified when a competitor near one of your salons closes
      </p>
      <p className="text-sm text-gray-600 mt-1">
        We&apos;ll watch a 3-mile radius around each location you own and email you when a
        competitor permanently closes — a signal it may be time to expand or go flagship.
      </p>
      {error && <p className="text-xs text-hs-red-600 mt-2">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => choose("enabled")}
          disabled={busy}
          className="min-h-[40px] px-4 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 disabled:opacity-60"
        >
          {busy ? "Setting up..." : "Enable alerts"}
        </button>
        <button
          type="button"
          onClick={() => choose("declined")}
          disabled={busy}
          className="min-h-[40px] px-3 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          No thanks
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Place on My Alerts and browse**

`src/app/account/alerts/page.tsx` — fetch visibility alongside alerts and render above the manager:

```ts
import { shouldShowOwnerAlertsPrompt } from "@/lib/owner-alerts/prompt"
import { OwnerAlertsPrompt } from "@/components/alerts/OwnerAlertsPrompt"
```

```ts
const [alerts, showOwnerPrompt] = await Promise.all([getMyAlerts(), shouldShowOwnerAlertsPrompt()])
```

```tsx
{showOwnerPrompt && (
  <div className="mb-6">
    <OwnerAlertsPrompt />
  </div>
)}
<AlertsManager initialAlerts={alerts} />
```

`src/app/browse/page.tsx` — add `shouldShowOwnerAlertsPrompt()` as another `Promise.all` member (destructure `showOwnerPrompt`), and render it as a `shrink-0` strip between `<SiteHeader>` and `<BrowsePage>` (the shell is viewport-clamped; `shrink-0` keeps the flex height chain intact):

```tsx
{showOwnerPrompt && (
  <div className="shrink-0 px-4 pt-3 max-w-7xl mx-auto w-full">
    <OwnerAlertsPrompt />
  </div>
)}
```

- [ ] **Step 5: Gate and commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/lib/owner-alerts/actions.ts src/lib/owner-alerts/prompt.ts src/components/alerts/OwnerAlertsPrompt.tsx src/app/account/alerts/page.tsx src/app/browse/page.tsx
git commit -m "feat(alerts): one-time owner closure-alerts opt-in prompt"
```

### Task 13: Cron branch (permanent-only for owner-auto) + email variant

**Files:**
- Modify: `src/lib/competitor-filter.ts` (add `eligibleClosuresForAlert`)
- Modify: `src/app/api/cron/competitor-alerts/route.ts:48-67`
- Modify: `src/lib/email.ts:61-74` (`CompetitorAlertData`) and `:293-297` (subject/intro)
- Test: extend `src/__tests__/competitor-filter.test.ts` (or create if the filter tests live elsewhere — check `src/__tests__/` for the existing competitor-filter cases and add alongside) and `src/__tests__/email.test.ts` / `src/__tests__/competitor-email.test.ts` (whichever holds `buildCompetitorAlertEmail` cases)

**Interfaces:**
- Consumes: `isOwnerAutoAlert` (Task 10).
- Produces: `eligibleClosuresForAlert(alert, closures)` — pure; `CompetitorAlertData.variant?: "saved-search" | "owner-location"`.

- [ ] **Step 1: Write the failing tests**

Add to the file holding `competitor-filter` tests (create `src/__tests__/competitor-filter-owner.test.ts` if none exists):

```ts
import { describe, it, expect } from "vitest"
import { eligibleClosuresForAlert } from "@/lib/competitor-filter"

const perm = { businessStatus: "CLOSED_PERMANENTLY" }
const temp = { businessStatus: "CLOSED_TEMPORARILY" }

describe("eligibleClosuresForAlert", () => {
  it("owner-auto alerts only see permanent closures", () => {
    expect(eligibleClosuresForAlert({ origin: "owner-auto" }, [perm, temp])).toEqual([perm])
  })
  it("regular saved searches keep both closure types", () => {
    expect(eligibleClosuresForAlert({ origin: "user" }, [perm, temp])).toEqual([perm, temp])
    expect(eligibleClosuresForAlert({ origin: null }, [perm, temp])).toEqual([perm, temp])
  })
})
```

Add to the email-builder test file (locate the existing `buildCompetitorAlertEmail` describe):

```ts
it("uses the owner-location subject for the owner-auto variant", () => {
  const { subject } = buildCompetitorAlertEmail({
    buyerEmail: "o@x.com",
    buyerName: "Owner",
    searchName: "Sugar House",
    searchUrl: "https://example.com/browse?x=1",
    variant: "owner-location",
    competitors: [{ brandName: "EWC", city: "SLC", state: "UT", nearestHsName: null, nearestHsMiles: null, mapsUrl: null }],
  })
  expect(subject).toBe("1 competitor closure near Sugar House")
})
```

Run both files: expect FAIL (missing export / missing field).

- [ ] **Step 2: Implement**

`src/lib/competitor-filter.ts` — append:

```ts
import { isOwnerAutoAlert } from "./owner-alerts/constants"
```

(Adjust the relative path: from `src/lib/competitor-filter.ts` it is `./owner-alerts/constants`.)

```ts
/**
 * Which closures an alert may match. Owner-auto alerts fire on permanent
 * closures only (spec decision); regular saved searches keep both types.
 */
export function eligibleClosuresForAlert<T extends { businessStatus: string }>(
  alert: { origin: string | null | undefined },
  closures: T[]
): T[] {
  return isOwnerAutoAlert(alert)
    ? closures.filter((c) => c.businessStatus === "CLOSED_PERMANENTLY")
    : closures
}
```

`src/lib/email.ts` — `CompetitorAlertData` gains:

```ts
/** 'owner-location' = an owner-auto alert around an owned salon. */
variant?: "saved-search" | "owner-location"
```

`buildCompetitorAlertEmail` — replace the subject line (line 296) and the intro paragraph (line 323):

```ts
const ownerVariant = data.variant === "owner-location"
const subject = ownerVariant
  ? `${n} competitor closure${n !== 1 ? "s" : ""} near ${searchName}`
  : `${n} new competitor closure${n !== 1 ? "s" : ""} near your saved search`
```

```ts
const intro = ownerVariant
  ? `${n} competitor${n !== 1 ? "s" : ""} permanently closed near your location <strong>${searchName}</strong>:`
  : `${n} new competitor closure${n !== 1 ? "s" : ""} appeared in the area of your saved search <strong>${searchName}</strong>:`
```

(and use `<p>${intro}</p>` in the html template where the old sentence was).

`src/app/api/cron/competitor-alerts/route.ts` — inside the loop, before `filterCompetitorsByScope` (line 49):

```ts
import { eligibleClosuresForAlert } from "@/lib/competitor-filter"
import { isOwnerAutoAlert } from "@/lib/owner-alerts/constants"
```

```ts
const pool = eligibleClosuresForAlert(alert, allCompetitors)
const inScope = filterCompetitorsByScope(pool, scope)
```

and extend the send call:

```ts
const res = await sendCompetitorAlertEmail({
  buyerEmail: user.email,
  buyerName: user.name || "Hello Sugar Buyer",
  searchName: alert.name || alert.centerLabel || "your saved search",
  searchUrl: `${appUrl}/browse?${savedSearchToBrowseParams(alert)}&showCompetitors=true`,
  variant: isOwnerAutoAlert(alert) ? "owner-location" : "saved-search",
  competitors: fresh.map((c) => ({
    brandName: c.brandName,
    city: c.city,
    state: c.state,
    nearestHsName: c.nearestHsName,
    nearestHsMiles: c.nearestHsMiles,
    mapsUrl: c.mapsUrl,
  })),
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run` (full suite — the cron test's existing fixtures have no `origin`, which flows through `eligibleClosuresForAlert` as the both-types branch; add `origin: "user"` to any fixture that fails typecheck).
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/competitor-filter.ts src/lib/email.ts src/app/api/cron/competitor-alerts/route.ts src/__tests__/
git commit -m "feat(alerts): owner-auto cron branch (permanent-only) and owner email variant"
```

### Task 14: My Alerts — "Your locations" group, radius editor, no delete for owner-auto

**Files:**
- Modify: `src/lib/alert-actions.ts:168-183` (`deleteAlert` guard)
- Modify: `src/app/account/alerts/AlertsManager.tsx` (grouping + radius handler)
- Modify: `src/components/alerts/SavedSearchCard.tsx` (owner-auto mode)

**Interfaces:**
- Consumes: `isOwnerAutoAlert`, `OWNER_AUTO_RADIUS_MILES` (Task 10); `updateAlert` (existing — patches only provided keys, so `updateAlert(id, { radiusMiles })` is safe).
- Produces: `SavedSearchCard` gains optional prop `onRadiusChange?: (id: string, radiusMiles: number) => Promise<void>`.

- [ ] **Step 1: Server-side delete guard**

In `src/lib/alert-actions.ts` `deleteAlert`, after the ownership check (line 175-177):

```ts
import { isOwnerAutoAlert } from "@/lib/owner-alerts/constants"
```

```ts
if (isOwnerAutoAlert(existing)) {
  return { error: "This alert is managed from your owned locations. Turn off Notify to silence it." }
}
```

Add a case to the existing `deleteAlert` tests in `src/__tests__/alert-actions.test.ts` using that file's established session/db mocks — the new assertion:

```ts
it("refuses to delete an owner-auto alert", async () => {
  // arrange the existing-alert mock with { userId: <session user>, origin: "owner-auto" }
  const result = await deleteAlert("auto-alert-id")
  expect(result.error).toMatch(/managed from your owned locations/)
})
```

- [ ] **Step 2: Group in AlertsManager and add the radius handler**

In `src/app/account/alerts/AlertsManager.tsx`:

```ts
import { isOwnerAutoAlert } from "@/lib/owner-alerts/constants"
```

Add next to the other handlers:

```ts
async function handleRadiusChange(id: string, radiusMiles: number) {
  setError(null)
  try {
    const result = await updateAlert(id, { radiusMiles })
    if (result.error) setError(result.error)
    else setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, radiusMiles } : a)))
  } catch {
    setError("Couldn't update — check your connection and try again.")
  }
}
```

Replace the single list render (lines 58-73) with two groups (keep the existing empty-state branch as-is above this):

```tsx
const ownerAuto = alerts.filter((a) => isOwnerAutoAlert(a))
const manual = alerts.filter((a) => !isOwnerAutoAlert(a))

return (
  <div className="space-y-6">
    {error && (
      <div role="alert" className="bg-hs-red-50 border border-hs-red-200 text-hs-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
    )}
    {ownerAuto.length > 0 && (
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Your locations</h3>
        <div className="space-y-4">
          {ownerAuto.map((alert) => (
            <SavedSearchCard
              key={alert.id}
              alert={alert}
              onRename={handleRename}
              onDelete={handleDelete}
              onToggleNotify={handleToggleNotify}
              onRadiusChange={handleRadiusChange}
            />
          ))}
        </div>
      </div>
    )}
    {manual.length > 0 && (
      <div>
        {ownerAuto.length > 0 && (
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Saved searches</h3>
        )}
        <div className="space-y-4">
          {manual.map((alert) => (
            <SavedSearchCard
              key={alert.id}
              alert={alert}
              onRename={handleRename}
              onDelete={handleDelete}
              onToggleNotify={handleToggleNotify}
            />
          ))}
        </div>
      </div>
    )}
  </div>
)
```

- [ ] **Step 3: Owner-auto mode on the card**

In `src/components/alerts/SavedSearchCard.tsx`:

1. Extend the props:

```ts
import { isOwnerAutoAlert } from "@/lib/owner-alerts/constants"
import { RADIUS_MIN_MILES, RADIUS_MAX_MILES } from "@/components/browse/FilterBar"

interface SavedSearchCardProps {
  alert: Alert
  onRename: (id: string, name: string | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToggleNotify: (id: string, enabled: boolean) => Promise<void>
  onRadiusChange?: (id: string, radiusMiles: number) => Promise<void>
}
```

2. Inside the component: `const ownerAuto = isOwnerAutoAlert(alert)`, plus local state for the radius draft:

```ts
const [draftRadius, setDraftRadius] = useState(alert.radiusMiles ?? 3)
const [savingRadius, setSavingRadius] = useState(false)
```

3. Add a "Your location" badge next to the title when `ownerAuto`:

```tsx
{ownerAuto && (
  <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide bg-green-100 text-green-700 px-2 py-0.5 rounded-full mb-1">
    Your location
  </span>
)}
```

4. In the actions row (lines 68-79): render the radius editor for owner-auto cards and hide Delete:

```tsx
{ownerAuto && onRadiusChange && (
  <div className="flex items-center gap-2 text-sm text-gray-600">
    <label htmlFor={`radius-${alert.id}`} className="whitespace-nowrap">Radius</label>
    <input
      id={`radius-${alert.id}`}
      type="number"
      min={RADIUS_MIN_MILES}
      max={RADIUS_MAX_MILES}
      value={draftRadius}
      onChange={(e) => setDraftRadius(Number(e.target.value))}
      className="h-9 w-16 rounded-lg border border-gray-300 px-2 text-sm"
    />
    <span>mi</span>
    {draftRadius !== (alert.radiusMiles ?? 3) && (
      <button
        type="button"
        disabled={savingRadius || draftRadius < RADIUS_MIN_MILES || draftRadius > RADIUS_MAX_MILES}
        onClick={async () => {
          setSavingRadius(true)
          await onRadiusChange(alert.id, draftRadius)
          setSavingRadius(false)
        }}
        className="text-sm font-semibold text-hs-red-600 hover:text-hs-red-700 disabled:opacity-50"
      >
        {savingRadius ? "Saving..." : "Update"}
      </button>
    )}
  </div>
)}
{!ownerAuto && (
  <button onClick={() => onDelete(alert.id)} className="inline-flex items-center min-h-[40px] px-2 -mr-2 text-sm font-medium text-hs-red-600 hover:text-hs-red-700 ml-auto">Delete</button>
)}
```

(The existing Delete button line is replaced by the `!ownerAuto` version; Rename and the Notify toggle stay for both kinds.)

- [ ] **Step 4: Gate and commit**

```bash
npx tsc --noEmit && npx vitest run
git add src/lib/alert-actions.ts src/app/account/alerts/AlertsManager.tsx src/components/alerts/SavedSearchCard.tsx src/__tests__/alert-actions.test.ts
git commit -m "feat(alerts): Your-locations group with radius editor; owner-auto alerts undeletable"
```

### Task 15: Open PR 3 + rollout notes

- [ ] **Step 1: Full-suite gate** — `npx tsc --noEmit && npx vitest run`, both clean.

- [ ] **Step 2: Optional manual check (Parker runs the dev server)**

As a linked owner with `owner_alerts_choice` null: prompt appears on `/browse` and `/account/alerts`; Enable → owner-auto cards appear under "Your locations" (3 mi, notify on, no Delete, radius editable); "No thanks" → never again. `EMAIL_OVERRIDE` must be set to test any email locally.

- [ ] **Step 3: Push and create the PR**

```bash
git push -u origin feature/owner-closure-alerts
gh pr create --base main --title "feat(alerts): automatic owner closure alerts (opt-in)" --body "<summary of Tasks 9-14, link the spec; call out the migration>"
```

- [ ] **Step 4: Rollout sequencing (record in the PR body)**

1. Migration 0009 was already applied to the shared Neon DB in Task 9 (column additions are backward-compatible — the deployed code ignores them).
2. Merge → Vercel prod deploy.
3. Verify next Tuesday's `/api/cron/competitor-alerts` run (`processed`/`emailed` counts in the cron logs); owner-auto alerts only email on `CLOSED_PERMANENTLY`.
4. Known limitation (accepted in spec): reconcile runs at login, so a user who never signs in again won't pick up newly acquired locations until they do.

---

## Plan Self-Review Notes

- Spec coverage: F1 → Tasks 9-15; F2 → Tasks 4-8; F3 → Tasks 1-3; scope step for ALL saves → Task 5; permanent-only → Task 13; no-delete + radius editor → Task 14; ledger seeding on create → Task 11 (reconciler) and existing `createAlert` path (watch dialog); prompt placement → Task 12; three-PR rollout → Tasks 3/8/15.
- Deliberately NOT done: no new index on `alerts.user_id` (pre-existing gap, out of scope); no reseeding on radius widen (matches existing updateAlert behavior); no dedupe of the same salon under two owner identifiers (soft-key-per-pair, harmless duplicate alert).
