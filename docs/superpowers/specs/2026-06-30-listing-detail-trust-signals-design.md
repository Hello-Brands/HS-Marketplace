# Listing Detail — Trust Signals & Review Carousel

**Date:** 2026-06-30
**Status:** Approved design, pending implementation plan

## Summary

Four self-contained UI tweaks to the listing detail page (`src/app/listings/[id]/page.tsx`)
that make the provenance of each number clearer to buyers and let them explore more
reviews. No data-model or schema changes to Postgres; the only data-layer change reuses
review rows already fetched from BigQuery.

The unifying idea: **distinguish Hello Sugar–verified data from owner-reported data**, and
give buyers more to read.

1. Reviews & Reputation — page through the top 5 reviews instead of showing one.
2. Performance Data — a "Verified by Hello Sugar" badge on the section heading.
3. Financials — a neutral "Provided by owner" pill on owner-entered cards.
4. Asking Price — recolor the highlight card from alarm-red to brand caramel.

## 1. Review carousel

**Component:** `src/components/kpi/LocationReviewsPanel.tsx`
**Data:** `src/lib/bigquery/queries.ts`, `src/lib/kpi/fetch.ts`

Today `LocationReviewsPanel` renders a single `featured` review. The BigQuery query
(`REVIEW_SUMMARY_SQL`) already pulls the **top 8 comment-bearing candidate reviews** per
location (`rn <= 8`), and `rowsToReviewSummaryByLocation` builds a `candidates` array, then
`pickFeaturedReview` collapses it to one. We will expose the top **5** instead of discarding them.

### Data changes
- Add `topReviews: FeaturedReview[]` to the `LocationReviewSummary` type (ordered best-first
  using the **existing** `pickFeaturedReview` ranking heuristic — rating desc, preferred
  comment-length window, owner-replied, recency).
- Keep `featured` as `topReviews[0] ?? null` for backward compatibility, OR replace `featured`
  usages with `topReviews`. Decide during planning; prefer keeping `featured` to minimize blast radius.
- `rowsToReviewSummaryByLocation`: instead of only calling `pickFeaturedReview`, produce a
  ranked array. Extract the existing sort comparator into a reusable function (e.g.
  `rankFeaturedReviews(candidates): FeaturedReview[]`) and take `.slice(0, 5)`.
  `pickFeaturedReview` becomes `rankFeaturedReviews(...)[0] ?? null`.
- `fetchLocationReviews` (in `src/lib/kpi/fetch.ts`) threads the new field through unchanged in shape.

### UI changes
- `LocationReviewsPanel` becomes a **client component** (`'use client'`) to hold the current-index state.
- Left summary column (rating, stars, distribution) is unchanged.
- Right "Top review" card gains, in its header row: the `★ Top reviews` label on the left;
  on the right, a compact `‹` button, a `n / total` counter, and a `›` button (circular,
  bordered, hover → brand accent). Below the card, a row of position dots (active dot in brand color).
- Paging is **manual only** — no auto-rotate.
- Arrows disabled/wrapped at the ends (decide wrap vs. disable in planning; default: disable at ends).
- If only one review exists, render exactly as today (no arrows, no dots, no counter).
- Accessibility: arrows are real `<button>`s with `aria-label`; counter announces position.

## 2. "Verified by Hello Sugar" on Performance Data

**Component:** `src/components/kpi/KpiSection.tsx`

- In the single-location branch, render a small badge **next to the "Performance Data"
  `<h2>`** heading: blue pill, check icon, text "Verified by Hello Sugar". Reuse the exact
  blue styling of the existing badge at the top of the listing page (`bg-blue-100 text-blue-800`,
  same check SVG) so it reads as the same mark.
- Show the badge only when data is actually live (`revenueLive === true`). When not connected,
  no badge.
- Per-card green **Live** pills (`KpiCard` `badge="live"`) are unchanged.
- Bundle Performance section: out of scope for now (the user's focus was single-location). Leave as-is.

## 3. "Provided by owner" on Financials

**Component:** `src/components/listing-detail/FinancialsGrid.tsx`

- `MetricCard` gains an optional `ownerProvided?: boolean` prop. When true, render a small
  **gray** pill in the top-right corner (`bg-gray-100 text-gray-500`, pill radius, text
  "Provided by owner"). Gray is deliberate — it must NOT look like the blue "verified" badge.
  Card becomes `relative` to anchor the pill.
- Apply `ownerProvided` to: **Asking Price** card and **TTM Profit** card.
- Also add an equivalent "Provided by owner" pill to the **Included Assets** card
  (top-right of that card's box).
- **Square footage** (in the page header and the Location Details sidebar card) is **left
  unlabeled** for now — out of scope.

## 4. Asking Price color → caramel

**Component:** `src/components/listing-detail/FinancialsGrid.tsx`

- The `variant="primary"` card currently uses `hs-red-50 / hs-red-200 / hs-red-600 / hs-red-700`.
  Recolor it to Hello Sugar's warm **caramel/accent** family (brand `accent` `#BB8265`,
  `accent-soft` `#E2CCB9`, with a darker caramel for the value text).
- Wire to a **token**, not a one-off hex. The marketplace defines its palette as CSS variables
  in `src/app/globals.css` and a Tailwind setup. Add caramel/accent tokens there (e.g.
  `--hs-accent-*`) mirroring the brand values, and reference them via Tailwind classes — matching
  the existing `hs-red-*` pattern. Exact token names decided in planning.
- Only the Asking Price (primary) card changes; the default white cards are untouched.

## Out of scope
- Square-footage provenance labeling.
- Bundle-listing Performance Data verified badge.
- Any change to how reviews are fetched/ranked beyond exposing the existing top candidates.
- Auto-rotation / animated transitions on the carousel.

## Testing
- Existing review tests (`src/__tests__/kpi/fetch-reviews.test.ts`,
  `src/__tests__/kpi/reviews-display.test.ts`, `src/__tests__/bigquery/reviews.test.ts`)
  must be updated for the new `topReviews` field and `rankFeaturedReviews` extraction.
- Add a unit test that `rankFeaturedReviews` returns ≤5, best-first, and that single-candidate
  input yields a one-element array.
- Component-level: panel with 1 review shows no controls; panel with ≥2 shows arrows/dots/counter.
- Verify `next build` / `tsc` clean (dev server stopped first — Windows `.next` lock).
