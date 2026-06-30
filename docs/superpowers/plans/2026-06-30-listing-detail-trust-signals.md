# Listing Detail — Trust Signals & Review Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each number's provenance clear on the listing detail page (owner-reported vs. Hello Sugar-verified), recolor the Asking Price box off alarm-red, and let buyers page through the top 5 reviews.

**Architecture:** Four independent changes. Financials (color + "Provided by owner" pills) and the Performance Data "Verified by Hello Sugar" badge are pure presentational edits. The review carousel reuses review rows already fetched from BigQuery — the only logic change is exposing the top 5 (currently ranked then all-but-one discarded), extracted into a pure, unit-tested function; the panel becomes a client component to hold paging state.

**Tech Stack:** Next.js (App Router — this is a customized build; consult `node_modules/next/dist/docs/` before writing client/server boundary code), React, TypeScript, Tailwind CSS **v4** (CSS-first config via `@theme inline` in `globals.css` — there is no `tailwind.config.*`), Vitest.

## Global Constraints

- **Tailwind v4, CSS-first.** New color utilities must be registered as `--color-*` entries inside the `@theme inline { … }` block in `src/app/globals.css`, mirroring the existing `--color-hs-red-*` pattern. No `tailwind.config.js` exists; do not create one.
- **Brand colors via tokens, never one-off hex** in components. Caramel values come from the Hello Sugar brand: `accent #BB8265`, `accent-soft #E2CCB9`.
- **"Verified" badge must reuse the existing blue style** already on the listing page (`src/app/listings/[id]/page.tsx:94-99`): `bg-blue-100 text-blue-800`, same check SVG. The owner pill must be **neutral gray** (`bg-gray-100 text-gray-500`) so it never looks "verified."
- **Test harness is limited:** Vitest `environment: "node"`, `include: ["src/__tests__/**/*.test.ts"]` only (no `.tsx`), no testing-library/jsdom. Put testable logic in **pure functions** with `.test.ts` coverage. Do **not** write React render tests — they cannot run here.
- **Windows build lock:** the dev server must be stopped before `next build` (`.next` lock on this machine). Use `npx tsc --noEmit` as the fast per-task gate; `next build` only when explicitly verifying. Lint is known-broken pre-existing — do not treat lint failures as task failures.
- **Commit after each task.** Branch is `fix/browse-search-oval-header-zindex` (work continues here unless told otherwise).

---

### Task 1: Financials — caramel Asking Price + "Provided by owner" pills

**Files:**
- Modify: `src/app/globals.css` (add caramel tokens; raw vars in `:root` ~line 23, theme registration in `@theme inline` ~line 118)
- Modify: `src/components/listing-detail/FinancialsGrid.tsx` (recolor primary `MetricCard`, add `ownerProvided` pill, apply to Asking Price + TTM Profit, add pill to Included Assets card)

**Interfaces:**
- Produces: `MetricCard` gains optional prop `ownerProvided?: boolean`. No other task depends on this.

- [ ] **Step 1: Add caramel raw variables to `:root` in `globals.css`**

Insert after the `--hs-red-900` line (line 23) in `src/app/globals.css`:

```css
  /* Hello Sugar Caramel (warm accent — used for the Asking Price highlight) */
  --hs-caramel-50: #f6ede6;   /* card background */
  --hs-caramel-200: #e2ccb9;  /* border (brand accent-soft) */
  --hs-caramel-600: #9c6a4f;  /* label text */
  --hs-caramel-700: #7c5238;  /* value text */
```

- [ ] **Step 2: Register caramel utilities in the `@theme inline` block**

Insert after the `--color-hs-red-900` line (line 118) in `src/app/globals.css`:

```css
  --color-hs-caramel-50: var(--hs-caramel-50);
  --color-hs-caramel-200: var(--hs-caramel-200);
  --color-hs-caramel-600: var(--hs-caramel-600);
  --color-hs-caramel-700: var(--hs-caramel-700);
```

- [ ] **Step 3: Recolor the primary `MetricCard` and add the `ownerProvided` pill**

In `src/components/listing-detail/FinancialsGrid.tsx`, replace the `MetricCardProps` interface and `MetricCard` function (lines 16-54) with:

```tsx
interface MetricCardProps {
  label: string
  value: string
  subLabel?: string
  variant?: 'default' | 'primary'
  ownerProvided?: boolean
}

function MetricCard({ label, value, subLabel, variant = 'default', ownerProvided }: MetricCardProps) {
  const isPrimary = variant === 'primary'
  return (
    <div
      className={`
        relative rounded-xl p-4 transition-all duration-200
        ${isPrimary
          ? 'bg-hs-caramel-50 border-2 border-hs-caramel-200'
          : 'bg-white border border-gray-200'
        }
      `}
    >
      {ownerProvided && (
        <span className="absolute top-3 right-3 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
          Provided by owner
        </span>
      )}
      <p className={`text-sm mb-1 ${isPrimary ? 'text-hs-caramel-600 font-medium' : 'text-gray-500'}`}>
        {label}
      </p>
      <p
        className={`font-bold tabular-nums ${
          isPrimary
            ? 'text-3xl text-hs-caramel-700'
            : 'text-2xl text-gray-900'
        }`}
      >
        {value}
      </p>
      {subLabel && (
        <p className={`text-xs mt-1 ${isPrimary ? 'text-hs-caramel-600' : 'text-gray-400'}`}>
          {subLabel}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Pass `ownerProvided` to the Asking Price and TTM Profit cards**

In the same file, update the two `MetricCard` usages (lines 60-69) to add `ownerProvided`:

```tsx
        <MetricCard
          label="Asking Price"
          value={formatPrice(listing.askingPrice)}
          variant="primary"
          ownerProvided
        />
        <MetricCard
          label="TTM Profit"
          value={formatPrice(listing.ttmProfit)}
          subLabel="Trailing 12 months"
          ownerProvided
        />
```

- [ ] **Step 5: Add the pill to the Included Assets card**

In the same file, change the Included Assets wrapper `<div>` (line 79) from:

```tsx
        <div className="border border-gray-200 rounded-xl p-4 bg-white">
          <p className="text-sm font-medium text-gray-700 mb-3">Included Assets</p>
```

to:

```tsx
        <div className="relative border border-gray-200 rounded-xl p-4 bg-white">
          <span className="absolute top-3 right-3 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
            Provided by owner
          </span>
          <p className="text-sm font-medium text-gray-700 mb-3">Included Assets</p>
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `FinancialsGrid.tsx`.

- [ ] **Step 7: Visual check**

Confirm in the browser (or against the approved mockup `asking-price-color.html` / `financials-owner.html`): Asking Price card is warm caramel (not red), gray "Provided by owner" pills appear top-right on Asking Price, TTM Profit, and Included Assets, and don't overlap their labels at mobile width.

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css src/components/listing-detail/FinancialsGrid.tsx
git commit -m "feat(listing-detail): caramel Asking Price box + 'Provided by owner' pills"
```

---

### Task 2: Expose top-5 reviews (pure ranking function)

**Files:**
- Modify: `src/lib/bigquery/queries.ts` (add `topReviews` to `LocationReviewSummary`, extract `rankFeaturedReviews`, populate in `rowsToReviewSummaryByLocation`)
- Test: `src/__tests__/bigquery/reviews.test.ts`

**Interfaces:**
- Produces:
  - `LocationReviewSummary` gains `topReviews: FeaturedReview[]` (ranked best-first, ≤5).
  - `export function rankFeaturedReviews(candidates: FeaturedReview[]): FeaturedReview[]`
  - `pickFeaturedReview` stays (now delegates to `rankFeaturedReviews`); `featured` field is unchanged.
- Consumes: nothing new (`FeaturedReview` already exists).

- [ ] **Step 1: Write failing tests for `rankFeaturedReviews` and `topReviews`**

Append to `src/__tests__/bigquery/reviews.test.ts` (the file already imports from `@/lib/bigquery/queries` and defines the `review()` helper and `baseRow`):

```ts
import {
  rankFeaturedReviews,
} from "@/lib/bigquery/queries"

describe("rankFeaturedReviews", () => {
  it("returns an empty array when no candidate has a comment", () => {
    expect(rankFeaturedReviews([])).toEqual([])
    expect(rankFeaturedReviews([review({ comment: "   " })])).toEqual([])
  })

  it("ranks best-first using the same heuristic as pickFeaturedReview", () => {
    const long = review({ comment: "a".repeat(1000), date: "2026-05-01" })
    const windowed = review({ comment: "b".repeat(200), date: "2026-01-01" })
    const ranked = rankFeaturedReviews([long, windowed])
    expect(ranked[0].comment).toBe("b".repeat(200)) // in-window preferred
    expect(ranked).toHaveLength(2)
  })

  it("agrees with pickFeaturedReview on the top element", () => {
    const a = review({ rating: 4, comment: "x".repeat(200), date: "2026-01-01" })
    const b = review({ rating: 5, comment: "y".repeat(200), date: "2026-02-01" })
    expect(rankFeaturedReviews([a, b])[0]).toEqual(pickFeaturedReview([a, b]))
  })
})

describe("rowsToReviewSummaryByLocation topReviews", () => {
  it("exposes up to 5 ranked comment-bearing reviews", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      ...baseRow,
      REVIEWER_DISPLAY_NAME: `Reviewer ${i}`,
      COMMENT: "k".repeat(200),
      create_date: `2026-0${(i % 8) + 1}-01`.replace("0", "0"),
    }))
    const s = rowsToReviewSummaryByLocation(rows).get("AZ Peoria | Park West 007")!
    expect(s.topReviews.length).toBe(5)
    expect(s.topReviews[0]).toEqual(s.featured)
  })

  it("returns a one-element topReviews and matching featured for a single candidate", () => {
    const s = rowsToReviewSummaryByLocation([baseRow]).get("AZ Peoria | Park West 007")!
    expect(s.topReviews).toHaveLength(1)
    expect(s.topReviews[0]).toEqual(s.featured)
  })

  it("returns an empty topReviews when no row has a comment", () => {
    const s = rowsToReviewSummaryByLocation([{ ...baseRow, COMMENT: null }]).get("AZ Peoria | Park West 007")!
    expect(s.topReviews).toEqual([])
    expect(s.featured).toBeNull()
  })
})
```

(Merge the new `import { rankFeaturedReviews }` into the existing import block from `@/lib/bigquery/queries` rather than adding a duplicate statement.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/bigquery/reviews.test.ts`
Expected: FAIL — `rankFeaturedReviews` is not exported; `s.topReviews` is undefined.

- [ ] **Step 3: Add `topReviews` to the type**

In `src/lib/bigquery/queries.ts`, update `LocationReviewSummary` (lines 176-181):

```ts
export type LocationReviewSummary = {
  avgRating: number
  totalReviews: number
  distribution: { stars: 1 | 2 | 3 | 4 | 5; count: number }[] // ordered 5,4,3,2,1
  featured: FeaturedReview | null
  topReviews: FeaturedReview[] // ranked best-first, ≤5; topReviews[0] === featured
}
```

- [ ] **Step 4: Extract `rankFeaturedReviews` and delegate `pickFeaturedReview`**

Replace `pickFeaturedReview` (lines 241-255) with:

```ts
/**
 * Pure: rank comment-bearing candidates best-first.
 * Order: rating desc -> 120-600 char window preferred -> owner-replied preferred
 * -> most recent. Relaxes the length window when nothing falls inside it.
 * Exported for tests.
 */
export function rankFeaturedReviews(candidates: FeaturedReview[]): FeaturedReview[] {
  const eligible = candidates.filter((c) => c.comment.trim().length > 0)
  const inWindow = (c: FeaturedReview) => c.comment.length >= 120 && c.comment.length <= 600

  return [...eligible].sort(
    (a, b) =>
      b.rating - a.rating ||
      (Number(inWindow(b)) - Number(inWindow(a))) ||
      (a.ownerReplied === b.ownerReplied ? 0 : a.ownerReplied ? -1 : 1) ||
      b.date.localeCompare(a.date)
  )
}

/**
 * Pure: pick one featured review from comment-bearing candidates.
 * Exported for tests.
 */
export function pickFeaturedReview(candidates: FeaturedReview[]): FeaturedReview | null {
  return rankFeaturedReviews(candidates)[0] ?? null
}
```

- [ ] **Step 5: Populate `topReviews` in `rowsToReviewSummaryByLocation`**

In the same function, replace the `map.set(name, { … })` block (lines 282-293) with:

```ts
    const ranked = rankFeaturedReviews(candidates)

    map.set(name, {
      avgRating: toNumber(head.avg_rating),
      totalReviews: toNumber(head.total_reviews),
      distribution: [
        { stars: 5, count: toNumber(head.c5) },
        { stars: 4, count: toNumber(head.c4) },
        { stars: 3, count: toNumber(head.c3) },
        { stars: 2, count: toNumber(head.c2) },
        { stars: 1, count: toNumber(head.c1) },
      ],
      featured: ranked[0] ?? null,
      topReviews: ranked.slice(0, 5),
    })
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/bigquery/reviews.test.ts`
Expected: PASS (all existing tests plus the new `rankFeaturedReviews` and `topReviews` cases).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`fetchLocationReviews` in `src/lib/kpi/fetch.ts` returns `LocationReviewSummary` unchanged — the new field flows through automatically.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/bigquery/queries.ts src/__tests__/bigquery/reviews.test.ts
git commit -m "feat(reviews): expose ranked top-5 reviews via rankFeaturedReviews"
```

---

### Task 3: Review carousel UI

**Files:**
- Modify: `src/components/kpi/LocationReviewsPanel.tsx` (convert to client component, page through `topReviews`)

**Interfaces:**
- Consumes: `LocationReviewSummary.topReviews: FeaturedReview[]` from Task 2; existing helpers `formatRating`, `starStates`, `formatReviewDate` from `@/lib/kpi/reviews-display`.
- Produces: nothing downstream.

Before editing, consult `node_modules/next/dist/docs/` for this build's client-component rules — the file is currently a server component imported by the server component `KpiSection`; it receives only serializable props (a plain review summary object), so a `'use client'` boundary here is safe.

- [ ] **Step 1: Rewrite `LocationReviewsPanel.tsx` as a paging client component**

Replace the entire contents of `src/components/kpi/LocationReviewsPanel.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import type { LocationReviewSummary } from '@/lib/bigquery/queries'
import { formatRating, starStates, formatReviewDate } from '@/lib/kpi/reviews-display'

function Stars({ avg, className = '' }: { avg: number; className?: string }) {
  return (
    <span className={`inline-flex gap-0.5 ${className}`} aria-label={`${formatRating(avg)} out of 5 stars`}>
      {starStates(avg).map((state, i) => (
        <span key={i} className={state === 'empty' ? 'text-gray-300' : 'text-amber-400'}>
          {state === 'half' ? '⯨' : state === 'full' ? '★' : '☆'}
        </span>
      ))}
    </span>
  )
}

export function LocationReviewsPanel({ reviews }: { reviews: LocationReviewSummary | null }) {
  const [index, setIndex] = useState(0)

  if (!reviews || reviews.totalReviews === 0) return null

  const { avgRating, totalReviews, distribution, topReviews } = reviews
  const maxCount = Math.max(...distribution.map((d) => d.count), 1)

  // Clamp in case a re-render hands us fewer reviews than the current index.
  const safeIndex = Math.min(index, Math.max(topReviews.length - 1, 0))
  const current = topReviews[safeIndex] ?? null
  const showControls = topReviews.length > 1

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Reviews &amp; Reputation</h3>
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 rounded-lg border border-gray-200 bg-white p-5">
        {/* Summary + distribution */}
        <div className="text-center md:border-r md:border-gray-100 md:pr-6">
          <div className="text-5xl font-semibold leading-none text-gray-900 tabular-nums">
            {formatRating(avgRating)}
          </div>
          <Stars avg={avgRating} className="mt-2 text-xl justify-center" />
          <p className="mt-1 text-sm text-gray-500">
            {totalReviews.toLocaleString('en-US')} Google reviews
          </p>
          <div className="mt-4 flex flex-col gap-1.5">
            {distribution.map((d) => (
              <div key={d.stars} className="grid grid-cols-[14px_1fr_38px] items-center gap-2">
                <span className="text-xs text-gray-500 tabular-nums">{d.stars}</span>
                <span className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <span
                    className="block h-full bg-amber-400 rounded-full"
                    style={{ width: `${(d.count / maxCount) * 100}%` }}
                  />
                </span>
                <span className="text-xs text-gray-400 text-right tabular-nums">
                  {totalReviews > 0 ? Math.round((d.count / totalReviews) * 100) : 0}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Featured review carousel */}
        {current ? (
          <div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">★ Top reviews</p>
                {showControls && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                      disabled={safeIndex === 0}
                      aria-label="Previous review"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-hs-red-300 hover:text-hs-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                    >
                      ‹
                    </button>
                    <span className="min-w-[34px] text-center text-xs tabular-nums text-gray-500">
                      {safeIndex + 1} / {topReviews.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIndex((i) => Math.min(i + 1, topReviews.length - 1))}
                      disabled={safeIndex === topReviews.length - 1}
                      aria-label="Next review"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-hs-red-300 hover:text-hs-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-gray-200 disabled:hover:text-gray-600"
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-800 text-sm font-semibold">
                  {current.reviewerName.charAt(0).toUpperCase()}
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-900">{current.reviewerName}</div>
                  <div className="text-xs text-gray-500">
                    {formatReviewDate(current.date)} · <Stars avg={current.rating} className="text-xs align-middle" />
                  </div>
                </div>
              </div>
              {current.comment.trim() && (
                <p className="text-sm text-gray-700">{current.comment}</p>
              )}
              {current.ownerReplied && (
                <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                  ✓ Owner replied
                </span>
              )}
            </div>
            {showControls && (
              <div className="mt-3 flex justify-center gap-1.5">
                {topReviews.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Go to review ${i + 1}`}
                    className={`h-[7px] rounded-full transition-all ${
                      i === safeIndex ? 'w-[18px] bg-hs-red-600' : 'w-[7px] bg-gray-300 hover:bg-gray-400'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-400">
            No written review available yet.
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`reviews.topReviews` resolves from Task 2's type change.)

- [ ] **Step 3: Run the review test suite (no regressions)**

Run: `npx vitest run src/__tests__/kpi src/__tests__/bigquery`
Expected: PASS (the panel is not unit-tested — node env has no DOM — but the data tests must stay green).

- [ ] **Step 4: Visual check**

Against the approved mockup `reviews-carousel.html` (Option A): header shows `★ Top reviews` with `‹ 1 / N ›`, dots below, prev disabled at start / next disabled at end, dots clickable. Confirm a location with exactly one review shows **no** arrows, counter, or dots (renders like before).

- [ ] **Step 5: Commit**

```bash
git add src/components/kpi/LocationReviewsPanel.tsx
git commit -m "feat(reviews): page through top-5 reviews with arrows + dots"
```

---

### Task 4: "Verified by Hello Sugar" badge on Performance Data

**Files:**
- Modify: `src/components/kpi/KpiSection.tsx` (add badge next to the single-location "Performance Data" `<h2>`)

**Interfaces:**
- Consumes: existing `revenueLive` boolean already computed in `KpiSectionContent`.
- Produces: nothing downstream.

- [ ] **Step 1: Add the verified badge to the single-location heading**

In `src/components/kpi/KpiSection.tsx`, replace the single-location `<h2>` (line 81) — currently:

```tsx
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Performance Data</h2>
```

with:

```tsx
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Performance Data</h2>
          {revenueLive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-lg">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Verified by Hello Sugar
            </span>
          )}
        </div>
```

The existing `<p className="text-sm text-gray-500 mb-6">…</p>` subtext line directly below stays unchanged. (Leave the bundle-listing heading at line 117 untouched — out of scope.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Visual check**

Against the approved mockup `verified-badge-recap.html` (Option B): a blue "✓ Verified by Hello Sugar" badge sits beside the "Performance Data" heading for a connected location, matching the badge at the top of the listing page; the per-card green "Live" pills are unchanged; a not-connected location shows no badge.

- [ ] **Step 4: Commit**

```bash
git add src/components/kpi/KpiSection.tsx
git commit -m "feat(kpi): 'Verified by Hello Sugar' badge on Performance Data heading"
```

---

## Self-Review

**Spec coverage:**
- Review carousel (top 5, manual, arrows disabled at ends, single-review fallback) → Tasks 2 + 3. ✓
- "Verified by Hello Sugar" on Performance Data heading, live-only, cards keep Live pill, bundle out of scope → Task 4. ✓
- "Provided by owner" gray pill on Asking Price + TTM Profit + Included Assets; square footage excluded → Task 1 (steps 3-5). ✓
- Asking Price → caramel via token → Task 1 (steps 1-3). ✓
- Out-of-scope items (sq-ft labeling, bundle badge, fetch/ranking beyond top candidates, auto-rotate) → none added. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows full content. ✓

**Type consistency:** `rankFeaturedReviews(candidates: FeaturedReview[]): FeaturedReview[]` and `topReviews: FeaturedReview[]` defined in Task 2 and consumed in Task 3; `ownerProvided?: boolean` defined and used within Task 1; `revenueLive` already exists in the file edited by Task 4. ✓
