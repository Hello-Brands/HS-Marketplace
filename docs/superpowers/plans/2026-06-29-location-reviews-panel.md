# Location Reviews Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Google-reviews panel to the listing detail page for Hello Sugar locations, showing average rating, total reviews, a 1–5 star distribution, and one featured positive review.

**Architecture:** Mirror the existing financial-KPI flow exactly: a cached BigQuery query produces a `Map<LOCATION_NAME, LocationReviewSummary>`; a gated fetch helper looks up the listing's `bqLocationName`; a presentational server component renders the panel below the existing `LocationKpiCards`. All heavy lifting (aggregation, featured-review selection, display formatting) lives in pure, unit-tested functions; the React component is dumb.

**Tech Stack:** Next.js 15 (App Router, server components), TypeScript, `@google-cloud/bigquery`, `unstable_cache`, Tailwind CSS v4, Vitest (node env).

## Global Constraints

These apply to every task:

- **Data source:** `even-affinity-388602.snowflake_data.vw_review_account_location_view_raw`. Join key is `LOCATION_NAME` (string), matched against the listing location's `bqLocationName`. There is no numeric location ID.
- **Hello Sugar only:** enforced implicitly — only owner-directory locations resolve a `bqLocationName`; competitor listings never do. No extra brand filter needed.
- **Scope:** single salon-type locations only (`listingType` is not `'bundle'` and not `'territory'`). Territory listings are already hidden by `KpiSection`.
- **Gate:** reuse `canFetchLiveData(listingStatus, mappingStatus)` unchanged (`listingStatus === 'active' && mappingStatus === 'confirmed'`). Reviews only render when the gate passes AND `bqLocationName` is non-null AND the location has review rows.
- **No negative review text anywhere.** The featured review is selected highest-rating-first; the distribution shows counts only.
- **Featured-review rule (deterministic):** among comment-bearing reviews — rating descending, then comment length within 120–600 chars preferred, then owner-replied (`REPLIED = true`) preferred, then most recent (`CREATE_DATE` desc). If none fall in the length window, relax the length constraint rather than returning null.
- **Styling:** match the existing KPI components' plain Tailwind utility style (e.g. `rounded-lg border border-gray-200 bg-gray-50 text-gray-900`). Do NOT introduce Hello Sugar CSS variables — the surrounding page does not use them. Stars use `text-amber-400` (filled) / `text-gray-300` (empty); no icon library (lucide etc. is not a dependency) — use the `★` / `☆` glyphs.
- **Tests:** Vitest, node environment. Test files live under `src/__tests__/**/*.test.ts` (only `.test.ts` is collected — not `.test.tsx`). Every test file that imports modules using `import "server-only"` must start with `vi.mock("server-only", () => ({}))` before those imports. Components are not unit-tested in this repo (no React Testing Library); cover logic in pure `.ts` helpers instead.
- **Per-step gates (Windows):** use `npx vitest run <file>` for tests and `npx tsc --noEmit` for type-checking. Do NOT run `next build` (Windows `.next` lock if the dev server is up) and do NOT rely on `npm run lint` (pre-existing breakage). Never start the dev server unprompted.

---

### Task 1: BigQuery query, types, and pure aggregation

Add the review query and all pure transform/selection logic to the existing queries module, plus a focused unit test for the selection logic and aggregation.

**Files:**
- Modify: `src/lib/bigquery/queries.ts` (append new types, SQL, pure functions, cached wrapper, and `getReviewSummaryByLocation`)
- Test: `src/__tests__/bigquery/reviews.test.ts` (create)

**Interfaces:**
- Consumes: `runQuery<T>` from `./client`, and the existing `Numeric` type + `toNumber()` helper already defined in `queries.ts`.
- Produces (relied on by Tasks 3 & 4):
  - `type FeaturedReview = { reviewerName: string; rating: number; date: string; comment: string; ownerReplied: boolean }`
  - `type LocationReviewSummary = { avgRating: number; totalReviews: number; distribution: { stars: 1|2|3|4|5; count: number }[]; featured: FeaturedReview | null }` — `distribution` has exactly 5 entries ordered `5,4,3,2,1`.
  - `function pickFeaturedReview(candidates: FeaturedReview[]): FeaturedReview | null`
  - `function rowsToReviewSummaryByLocation(rows: ReviewSummaryRow[]): Map<string, LocationReviewSummary>`
  - `async function getReviewSummaryByLocation(): Promise<Map<string, LocationReviewSummary>>`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/bigquery/reviews.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"

// Mock server-only to be a no-op in tests
vi.mock("server-only", () => ({}))

import {
  pickFeaturedReview,
  rowsToReviewSummaryByLocation,
  type FeaturedReview,
} from "@/lib/bigquery/queries"

const review = (over: Partial<FeaturedReview>): FeaturedReview => ({
  reviewerName: "Jane",
  rating: 5,
  date: "2026-01-01",
  comment: "x".repeat(200),
  ownerReplied: false,
  ...over,
})

describe("pickFeaturedReview", () => {
  it("returns null when there are no comment-bearing candidates", () => {
    expect(pickFeaturedReview([])).toBeNull()
    expect(pickFeaturedReview([review({ comment: "   " })])).toBeNull()
  })

  it("prefers a comment inside the 120-600 char window over a longer one", () => {
    const long = review({ comment: "a".repeat(1000), date: "2026-05-01" })
    const windowed = review({ comment: "b".repeat(200), date: "2026-01-01" })
    expect(pickFeaturedReview([long, windowed]).comment).toBe("b".repeat(200))
  })

  it("prefers owner-replied among same rating and both in window", () => {
    const notReplied = review({ comment: "c".repeat(200), ownerReplied: false, date: "2026-05-01" })
    const replied = review({ comment: "d".repeat(200), ownerReplied: true, date: "2026-01-01" })
    expect(pickFeaturedReview([notReplied, replied]).ownerReplied).toBe(true)
  })

  it("falls back to a short comment when none fall in the length window", () => {
    const short = review({ comment: "Great!", date: "2026-02-02" })
    expect(pickFeaturedReview([short]).comment).toBe("Great!")
  })

  it("breaks ties by recency (most recent wins)", () => {
    const older = review({ comment: "e".repeat(200), date: "2026-01-01" })
    const newer = review({ comment: "f".repeat(200), date: "2026-06-01" })
    expect(pickFeaturedReview([older, newer]).date).toBe("2026-06-01")
  })

  it("prefers higher rating before anything else", () => {
    const five = review({ rating: 5, comment: "g".repeat(50), date: "2026-01-01" })
    const four = review({ rating: 4, comment: "h".repeat(200), date: "2026-06-01" })
    expect(pickFeaturedReview([five, four]).rating).toBe(5)
  })
})

describe("rowsToReviewSummaryByLocation", () => {
  const baseRow = {
    LOCATION_NAME: "AZ Peoria | Park West 007",
    avg_rating: 4.84,
    total_reviews: 1516,
    c5: 1420,
    c4: 34,
    c3: 15,
    c2: 16,
    c1: 31,
    REVIEWER_DISPLAY_NAME: "Jordan Brown",
    NUMERIC_STAR_RATING: 5,
    COMMENT: "z".repeat(200),
    create_date: "2026-06-20",
    REPLIED: true,
  }

  it("filters out rows with a null LOCATION_NAME", () => {
    const map = rowsToReviewSummaryByLocation([{ ...baseRow, LOCATION_NAME: null }])
    expect(map.size).toBe(0)
  })

  it("computes avg, total, and a descending 5..1 distribution", () => {
    const map = rowsToReviewSummaryByLocation([baseRow])
    const s = map.get("AZ Peoria | Park West 007")!
    expect(s.avgRating).toBeCloseTo(4.84)
    expect(s.totalReviews).toBe(1516)
    expect(s.distribution).toEqual([
      { stars: 5, count: 1420 },
      { stars: 4, count: 34 },
      { stars: 3, count: 15 },
      { stars: 2, count: 16 },
      { stars: 1, count: 31 },
    ])
  })

  it("selects a featured review from the candidate rows", () => {
    const map = rowsToReviewSummaryByLocation([baseRow])
    const s = map.get("AZ Peoria | Park West 007")!
    expect(s.featured?.reviewerName).toBe("Jordan Brown")
    expect(s.featured?.ownerReplied).toBe(true)
  })

  it("sets featured to null when no candidate row has a comment", () => {
    const map = rowsToReviewSummaryByLocation([{ ...baseRow, COMMENT: null }])
    expect(map.get("AZ Peoria | Park West 007")!.featured).toBeNull()
  })

  it("groups multiple locations independently", () => {
    const other = { ...baseRow, LOCATION_NAME: "TX Houston | Heights 017", total_reviews: 1612 }
    const map = rowsToReviewSummaryByLocation([baseRow, other])
    expect(map.size).toBe(2)
    expect(map.get("TX Houston | Heights 017")!.totalReviews).toBe(1612)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/bigquery/reviews.test.ts`
Expected: FAIL — `pickFeaturedReview` / `rowsToReviewSummaryByLocation` are not exported (import or type errors).

- [ ] **Step 3: Implement the query, types, and pure functions**

Append to `src/lib/bigquery/queries.ts` (after the existing review-free code; reuse the existing `Numeric` type and `toNumber()` already defined near the top of the file — do not redefine them):

```ts
// ---- Reviews -------------------------------------------------------------

export type FeaturedReview = {
  reviewerName: string
  rating: number
  date: string // "YYYY-MM-DD"
  comment: string
  ownerReplied: boolean
}

export type LocationReviewSummary = {
  avgRating: number
  totalReviews: number
  distribution: { stars: 1 | 2 | 3 | 4 | 5; count: number }[] // ordered 5,4,3,2,1
  featured: FeaturedReview | null
}

// One row per candidate review (top 8 per location), carrying per-location
// aggregates as repeated window columns. create_date is pre-formatted to a
// plain "YYYY-MM-DD" string in SQL so we never touch BigQueryDate objects.
type ReviewSummaryRow = {
  LOCATION_NAME: string | null
  avg_rating: Numeric
  total_reviews: Numeric
  c1: Numeric
  c2: Numeric
  c3: Numeric
  c4: Numeric
  c5: Numeric
  REVIEWER_DISPLAY_NAME: string | null
  NUMERIC_STAR_RATING: Numeric
  COMMENT: string | null
  create_date: string | null
  REPLIED: boolean | null
}

const REVIEW_SUMMARY_SQL = `
  WITH base AS (
    SELECT
      LOCATION_NAME,
      NUMERIC_STAR_RATING,
      COMMENT,
      REVIEWER_DISPLAY_NAME,
      FORMAT_DATE('%Y-%m-%d', CREATE_DATE) AS create_date,
      REPLIED,
      AVG(NUMERIC_STAR_RATING) OVER (PARTITION BY LOCATION_NAME) AS avg_rating,
      COUNT(*) OVER (PARTITION BY LOCATION_NAME) AS total_reviews,
      COUNTIF(NUMERIC_STAR_RATING = 1) OVER (PARTITION BY LOCATION_NAME) AS c1,
      COUNTIF(NUMERIC_STAR_RATING = 2) OVER (PARTITION BY LOCATION_NAME) AS c2,
      COUNTIF(NUMERIC_STAR_RATING = 3) OVER (PARTITION BY LOCATION_NAME) AS c3,
      COUNTIF(NUMERIC_STAR_RATING = 4) OVER (PARTITION BY LOCATION_NAME) AS c4,
      COUNTIF(NUMERIC_STAR_RATING = 5) OVER (PARTITION BY LOCATION_NAME) AS c5,
      ROW_NUMBER() OVER (
        PARTITION BY LOCATION_NAME
        ORDER BY (COMMENT IS NOT NULL AND TRIM(COMMENT) != '') DESC,
                 NUMERIC_STAR_RATING DESC,
                 CREATE_DATE DESC
      ) AS rn
    FROM \`even-affinity-388602.snowflake_data.vw_review_account_location_view_raw\`
    WHERE LOCATION_NAME IS NOT NULL
  )
  SELECT
    LOCATION_NAME, avg_rating, total_reviews, c1, c2, c3, c4, c5,
    REVIEWER_DISPLAY_NAME, NUMERIC_STAR_RATING, COMMENT, create_date, REPLIED
  FROM base
  WHERE rn <= 8
  ORDER BY LOCATION_NAME, rn`

/**
 * Pure: pick one featured review from comment-bearing candidates.
 * Order: rating desc -> 120-600 char window preferred -> owner-replied preferred
 * -> most recent. Relaxes the length window when nothing falls inside it.
 * Exported for tests.
 */
export function pickFeaturedReview(candidates: FeaturedReview[]): FeaturedReview | null {
  const eligible = candidates.filter((c) => c.comment.trim().length > 0)
  if (eligible.length === 0) return null
  const inWindow = eligible.filter((c) => c.comment.length >= 120 && c.comment.length <= 600)
  const pool = inWindow.length > 0 ? inWindow : eligible
  const sorted = [...pool].sort(
    (a, b) =>
      b.rating - a.rating ||
      (a.ownerReplied === b.ownerReplied ? 0 : a.ownerReplied ? -1 : 1) ||
      b.date.localeCompare(a.date)
  )
  return sorted[0]
}

/** Pure: candidate rows -> per-location summary map. Exported for tests. */
export function rowsToReviewSummaryByLocation(
  rows: ReviewSummaryRow[]
): Map<string, LocationReviewSummary> {
  const grouped = new Map<string, ReviewSummaryRow[]>()
  for (const r of rows) {
    if (!r.LOCATION_NAME) continue
    const arr = grouped.get(r.LOCATION_NAME) ?? []
    arr.push(r)
    grouped.set(r.LOCATION_NAME, arr)
  }

  const map = new Map<string, LocationReviewSummary>()
  for (const [name, group] of grouped.entries()) {
    const head = group[0]
    const candidates: FeaturedReview[] = group
      .filter((r) => r.COMMENT && r.COMMENT.trim().length > 0)
      .map((r) => ({
        reviewerName: r.REVIEWER_DISPLAY_NAME ?? "Google reviewer",
        rating: toNumber(r.NUMERIC_STAR_RATING),
        date: r.create_date ?? "",
        comment: r.COMMENT as string,
        ownerReplied: r.REPLIED === true,
      }))

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
      featured: pickFeaturedReview(candidates),
    })
  }
  return map
}

const cachedReviewSummary = unstable_cache(
  async () => {
    const rows = await runQuery<ReviewSummaryRow>(REVIEW_SUMMARY_SQL)
    return Array.from(rowsToReviewSummaryByLocation(rows ?? []).entries())
  },
  ["bq-review-summary"],
  { revalidate: 86400, tags: ["bq-reviews"] }
)

export async function getReviewSummaryByLocation(): Promise<Map<string, LocationReviewSummary>> {
  return new Map(await cachedReviewSummary())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/bigquery/reviews.test.ts`
Expected: PASS (all cases in both `describe` blocks green).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bigquery/queries.ts src/__tests__/bigquery/reviews.test.ts
git commit -m "feat(reviews): BigQuery review summary query + featured-review selection"
```

---

### Task 2: Display helpers

Pure formatting helpers the component will use, kept in a `.ts` file so they are unit-tested (the component itself is not).

**Files:**
- Create: `src/lib/kpi/reviews-display.ts`
- Test: `src/__tests__/kpi/reviews-display.test.ts`

**Interfaces:**
- Produces (relied on by Task 4):
  - `function formatRating(avg: number): string` — two decimals, e.g. `4.84`.
  - `function starStates(avg: number): ('full' | 'half' | 'empty')[]` — always length 5, rounded to the nearest half star.
  - `function formatReviewDate(date: string): string` — `"YYYY-MM-DD"` → `"Jun 2026"`; returns `""` for empty/malformed input.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/kpi/reviews-display.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { formatRating, starStates, formatReviewDate } from "@/lib/kpi/reviews-display"

describe("formatRating", () => {
  it("formats to two decimals", () => {
    expect(formatRating(4.8421)).toBe("4.84")
    expect(formatRating(5)).toBe("5.00")
  })
})

describe("starStates", () => {
  it("rounds to the nearest half star and always returns 5 entries", () => {
    expect(starStates(5)).toEqual(["full", "full", "full", "full", "full"])
    expect(starStates(4.84)).toEqual(["full", "full", "full", "full", "full"]) // rounds to 5.0
    expect(starStates(4.6)).toEqual(["full", "full", "full", "full", "half"]) // rounds to 4.5
    expect(starStates(4.2)).toEqual(["full", "full", "full", "full", "empty"]) // rounds to 4.0
    expect(starStates(3.5)).toEqual(["full", "full", "full", "half", "empty"])
    expect(starStates(0)).toEqual(["empty", "empty", "empty", "empty", "empty"])
  })
})

describe("formatReviewDate", () => {
  it("formats YYYY-MM-DD to 'Mon YYYY'", () => {
    expect(formatReviewDate("2026-06-20")).toBe("Jun 2026")
    expect(formatReviewDate("2025-01-05")).toBe("Jan 2025")
  })
  it("returns empty string for empty or malformed input", () => {
    expect(formatReviewDate("")).toBe("")
    expect(formatReviewDate("nonsense")).toBe("")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/reviews-display.test.ts`
Expected: FAIL — module `@/lib/kpi/reviews-display` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/kpi/reviews-display.ts`:

```ts
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

/** Average rating to a fixed two-decimal string, e.g. 4.84. */
export function formatRating(avg: number): string {
  return avg.toFixed(2)
}

/** Five star slots, rounded to the nearest half star. */
export function starStates(avg: number): ("full" | "half" | "empty")[] {
  const rounded = Math.round(avg * 2) / 2 // nearest 0.5
  return Array.from({ length: 5 }, (_, i) => {
    const slot = i + 1
    if (rounded >= slot) return "full"
    if (rounded >= slot - 0.5) return "half"
    return "empty"
  })
}

/** "YYYY-MM-DD" -> "Jun 2026"; "" for empty/malformed input. */
export function formatReviewDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date)
  if (!m) return ""
  const monthIdx = Number(m[2]) - 1
  const label = MONTH_ABBR[monthIdx]
  return label ? `${label} ${m[1]}` : ""
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/kpi/reviews-display.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpi/reviews-display.ts src/__tests__/kpi/reviews-display.test.ts
git commit -m "feat(reviews): pure display helpers for rating, stars, and date"
```

---

### Task 3: Gated fetch helper

Add `fetchLocationReviews` parallel to the existing `fetchLocationRevenue` / `fetchLocationMembership`, and test the gate short-circuits (the only branches testable without a live BigQuery client).

**Files:**
- Modify: `src/lib/kpi/fetch.ts`
- Test: `src/__tests__/kpi/fetch-reviews.test.ts` (create)

**Interfaces:**
- Consumes: `getReviewSummaryByLocation` + `LocationReviewSummary` from `@/lib/bigquery/queries` (Task 1); `canFetchLiveData` from `./access`.
- Produces (relied on by Task 5): `async function fetchLocationReviews(args: { listingStatus: string; mappingStatus: string; bqLocationName: string | null }): Promise<LocationReviewSummary | null>`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/kpi/fetch-reviews.test.ts`. (These cases exercise the early-return guards, which run before any BigQuery call, so no client is needed.)

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { fetchLocationReviews } from "@/lib/kpi/fetch"

describe("fetchLocationReviews gating", () => {
  it("returns null when bqLocationName is null", async () => {
    const result = await fetchLocationReviews({
      listingStatus: "active",
      mappingStatus: "confirmed",
      bqLocationName: null,
    })
    expect(result).toBeNull()
  })

  it("returns null when the listing is not active", async () => {
    const result = await fetchLocationReviews({
      listingStatus: "draft",
      mappingStatus: "confirmed",
      bqLocationName: "AZ Peoria | Park West 007",
    })
    expect(result).toBeNull()
  })

  it("returns null when the mapping is not confirmed", async () => {
    const result = await fetchLocationReviews({
      listingStatus: "active",
      mappingStatus: "unconfirmed",
      bqLocationName: "AZ Peoria | Park West 007",
    })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/fetch-reviews.test.ts`
Expected: FAIL — `fetchLocationReviews` is not exported.

- [ ] **Step 3: Implement the fetch helper**

In `src/lib/kpi/fetch.ts`, extend the existing import from `@/lib/bigquery/queries` to also pull in the review summary, and add the helper. Update the import line:

```ts
import {
  getNetSalesByLocation,
  getMcrByLocation,
  getMcrTrendByLocation,
  getReviewSummaryByLocation,
  type LocationReviewSummary,
} from "@/lib/bigquery/queries"
```

Then append at the end of the file:

```ts
export async function fetchLocationReviews(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<LocationReviewSummary | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null // "not connected"
  }
  const map = await getReviewSummaryByLocation()
  return map.get(args.bqLocationName) ?? null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/kpi/fetch-reviews.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpi/fetch.ts src/__tests__/kpi/fetch-reviews.test.ts
git commit -m "feat(reviews): gated fetchLocationReviews helper"
```

---

### Task 4: LocationReviewsPanel component

A presentational server component rendering the two-column panel (summary + distribution | featured review). Returns `null` when there is no data, so it never adds layout when absent.

**Files:**
- Create: `src/components/kpi/LocationReviewsPanel.tsx`

**Interfaces:**
- Consumes: `LocationReviewSummary` from `@/lib/bigquery/queries` (Task 1); `formatRating`, `starStates`, `formatReviewDate` from `@/lib/kpi/reviews-display` (Task 2).
- Produces (relied on by Task 5): `function LocationReviewsPanel({ reviews }: { reviews: LocationReviewSummary | null }): JSX.Element | null`

- [ ] **Step 1: Create the component**

Create `src/components/kpi/LocationReviewsPanel.tsx`. No `'use client'` — it is purely presentational and renders inside the async server `KpiSectionContent`.

```tsx
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
  if (!reviews || reviews.totalReviews === 0) return null

  const { avgRating, totalReviews, distribution, featured } = reviews
  const maxCount = Math.max(...distribution.map((d) => d.count), 1)

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

        {/* Featured review */}
        {featured ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-3">★ Top review</p>
            <div className="flex items-center gap-3 mb-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-amber-100 text-amber-800 text-sm font-semibold">
                {featured.reviewerName.charAt(0).toUpperCase()}
              </span>
              <div>
                <div className="text-sm font-medium text-gray-900">{featured.reviewerName}</div>
                <div className="text-xs text-gray-500">
                  {formatReviewDate(featured.date)} · <Stars avg={featured.rating} className="text-xs align-middle" />
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-700">{featured.comment}</p>
            {featured.ownerReplied && (
              <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                ✓ Owner replied
              </span>
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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (There is no unit test for this file — the repo has no React Testing Library and only collects `.test.ts`. The logic it depends on is covered by Tasks 1 and 2.)

- [ ] **Step 3: Commit**

```bash
git add src/components/kpi/LocationReviewsPanel.tsx
git commit -m "feat(reviews): LocationReviewsPanel presentational component"
```

---

### Task 5: Wire the panel into KpiSection

Fetch reviews alongside revenue/membership for single-location listings and render the panel below `LocationKpiCards`. No change to `page.tsx` is needed — `KpiSection` already receives `bqLocationName`, `dataMappingStatus`, and `listingStatus`.

**Files:**
- Modify: `src/components/kpi/KpiSection.tsx`

**Interfaces:**
- Consumes: `fetchLocationReviews` (Task 3) and `LocationReviewsPanel` (Task 4).

- [ ] **Step 1: Add imports**

In `src/components/kpi/KpiSection.tsx`, update the fetch import and add the component import:

```tsx
import { fetchBundleKpi, fetchLocationRevenue, fetchLocationMembership, fetchLocationReviews } from '@/lib/kpi/fetch'
import { LocationReviewsPanel } from './LocationReviewsPanel'
```

- [ ] **Step 2: Fetch reviews in the single-location branch**

In `KpiSectionContent`, inside the `if (listingType !== 'bundle' && locationId) {` block, add a `reviews` fetch next to the existing `rev` / `mem` fetches. The block becomes:

```tsx
    let rev: Awaited<ReturnType<typeof fetchLocationRevenue>> = null
    let mem: Awaited<ReturnType<typeof fetchLocationMembership>> = null
    let reviews: Awaited<ReturnType<typeof fetchLocationReviews>> = null
    if (dataMappingStatus && listingStatus) {
      rev = await fetchLocationRevenue({
        listingStatus,
        mappingStatus: dataMappingStatus,
        bqLocationName: bqLocationName ?? null,
      })
      mem = await fetchLocationMembership({
        listingStatus,
        mappingStatus: dataMappingStatus,
        bqLocationName: bqLocationName ?? null,
      })
      reviews = await fetchLocationReviews({
        listingStatus,
        mappingStatus: dataMappingStatus,
        bqLocationName: bqLocationName ?? null,
      })
    }
```

- [ ] **Step 3: Render the panel**

In the same branch's returned JSX, add `LocationReviewsPanel` directly below `LocationKpiCards`:

```tsx
        <LocationKpiCards netSales={netSales} membership={mem} />
        <LocationReviewsPanel reviews={reviews} />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests plus the three new files green.

- [ ] **Step 6: Commit**

```bash
git add src/components/kpi/KpiSection.tsx
git commit -m "feat(reviews): render LocationReviewsPanel in KpiSection"
```

- [ ] **Step 7: Manual verification (optional, requires dev server — ask the user first)**

Do not start the dev server unprompted. When the user is ready, have them run `npm run dev`, open an **active** listing whose location mapping is **confirmed**, and confirm the "Reviews & Reputation" panel appears below the KPI cards with the rating, distribution bars, and a featured review. Confirm it is absent on a draft/unconfirmed listing and on territory/bundle listings.

---

## Self-Review

**Spec coverage:**
- Data source / `LOCATION_NAME` join → Task 1 (SQL + types). ✓
- Aggregates (avg, total, distribution) → Task 1 (`rowsToReviewSummaryByLocation`). ✓
- Featured-review rule (rating → length window → replied → recency, relax on empty window) → Task 1 (`pickFeaturedReview`, tested). ✓
- Null `LOCATION_NAME` filtered → Task 1 (SQL `WHERE` + JS guard, tested). ✓
- Caching (`unstable_cache`, `bq-reviews` tag, 24h) → Task 1. ✓
- Gate reuse (`canFetchLiveData`) + `bqLocationName` required → Task 3 (tested). ✓
- Single salon-type only; territory/bundle excluded → Task 5 (placed in the existing non-bundle branch; territory already hidden by `KpiSection`). ✓
- Hide panel entirely when no data → Task 4 (`return null`) + Task 3 (returns null). ✓
- No featured review → summary-only graceful state → Task 4 (tested null path in Task 1). ✓
- Star rounding to nearest 0.5; numeric to 2 decimals → Task 2 (`starStates`, `formatRating`, tested). ✓
- No negative review text; counts only in distribution → Tasks 1 & 4 (featured is rating-desc; distribution renders counts). ✓
- Match existing Tailwind styling, no brand CSS vars → Task 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code and test step contains full content. ✓

**Type consistency:** `LocationReviewSummary` / `FeaturedReview` defined in Task 1 and consumed unchanged in Tasks 3–4. `getReviewSummaryByLocation`, `fetchLocationReviews`, `LocationReviewsPanel`, `starStates`, `formatRating`, `formatReviewDate`, `pickFeaturedReview`, `rowsToReviewSummaryByLocation` are named identically wherever referenced. `distribution` ordering (5→1) is consistent between the producer (Task 1) and the renderer (Task 4). ✓
