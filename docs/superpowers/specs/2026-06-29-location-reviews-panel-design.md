# Location Reviews Panel — Design

**Date:** 2026-06-29
**Status:** Approved design, pending implementation plan
**Author:** Brainstormed with Claude Code

## Summary

Add a Google-reviews panel to the listing detail page for Hello Sugar
locations. For a single salon-type location, the panel shows the average star
rating, total review count, a 1–5 star distribution histogram, and one featured
positive review. Data is pulled live from BigQuery and keyed on the same
`LOCATION_NAME` string the financial KPIs already use. Competitor listings are
out of scope (they never resolve a `bqLocationName`).

This is "Direction B" from the visual exploration: a dedicated two-column panel
rendered below the existing Net Sales / MCR KPI cards.

## Goals

- Surface per-location review reputation to internal buyers evaluating a listing.
- Reuse the existing KPI/financial integration pattern end-to-end (BigQuery
  query → cached fetch → gated render → branded component).
- Show only positive signal: headline rating, volume, distribution, and a top
  review. No negative review text is surfaced anywhere.

## Non-goals

- No reviews for competitor locations.
- No reviews for territory listings or bundle listings (v1 is single salon-type
  locations only, matching the current `LocationKpiCards` behavior).
- No write-back, reply, or moderation features — read-only display.
- No carousel / multi-review rotation (that was Direction C, not chosen).

## Data source

**Table:** `even-affinity-388602.snowflake_data.vw_review_account_location_view_raw`
(Google Business Profile reviews, one row per review).

Relevant columns:

| Column | Use |
| --- | --- |
| `LOCATION_NAME` | Join key — matches `bqLocationName` on the listing location |
| `NUMERIC_STAR_RATING` | 1–5 integer rating (Google has no 0-star) |
| `COMMENT` | Review text (used for the featured review) |
| `REVIEWER_DISPLAY_NAME` | Featured review attribution |
| `CREATE_DATE` | Featured review date / recency ordering |
| `REPLIED` | Boolean — owner replied; used to prefer engaged reviews |

Data characteristics observed: ~63K reviews total, overwhelmingly 5-star
(avg ~4.8 per location). Some rows have `LOCATION_NAME IS NULL` and must be
filtered out. Many reviews have no comment; those still count toward
aggregates but are ineligible to be the featured review.

## Architecture

Mirrors the existing financial-KPI flow:

```
BigQuery view
  → getReviewSummaryByLocation()      [src/lib/bigquery/queries.ts]
      (unstable_cache, tag: "reviews")
  → fetchLocationReviews()            [src/lib/kpi/fetch.ts]
      (gated by canFetchLiveData)
  → KpiSection                        [src/components/kpi/KpiSection.tsx]
  → LocationReviewsPanel              [src/components/kpi/LocationReviewsPanel.tsx]
```

### 1. BigQuery query — `getReviewSummaryByLocation()`

Location: `src/lib/bigquery/queries.ts` (alongside `getNetSalesByLocation`,
`getMcrByLocation`).

- Returns `Promise<Map<string, LocationReviewSummary>>` keyed on `LOCATION_NAME`.
- Wrapped in `unstable_cache` with a `reviews` tag and a revalidation window
  consistent with the other KPI queries.
- A **single query** computes, per location, the aggregates and the featured
  review (one row per location via `QUALIFY ROW_NUMBER()`), so one round-trip
  populates the whole map.
- Filters `LOCATION_NAME IS NULL` out of all aggregation.

```ts
export type LocationReviewSummary = {
  avgRating: number;        // e.g. 4.84, raw average of NUMERIC_STAR_RATING
  totalReviews: number;     // e.g. 1516, all reviews regardless of comment
  distribution: { stars: 1 | 2 | 3 | 4 | 5; count: number }[]; // always 5 entries
  featured: {
    reviewerName: string;
    rating: number;         // 1–5
    date: string;           // ISO date
    comment: string;
    ownerReplied: boolean;
  } | null;                 // null when no comment-bearing review qualifies
};
```

**Featured-review selection rule (deterministic):** order eligible reviews by

1. rating descending (highest first),
2. comment length within 120–600 characters preferred (avoids one-liners and
   walls of text),
3. `REPLIED = true` preferred (signals an engaged operator),
4. `CREATE_DATE` descending (most recent).

If no review falls in the 120–600 length window, relax the length constraint
rather than returning null, so a featured review still appears when any
comment-bearing positive review exists.

### 2. Fetch + gating — `fetchLocationReviews()`

Location: `src/lib/kpi/fetch.ts` (parallel to `fetchLocationRevenue`,
`fetchLocationMembership`).

- Gate: reuse `canFetchLiveData(listingStatus, dataMappingStatus)` **unchanged**
  — i.e. `listingStatus === 'active' && mappingStatus === 'confirmed'`.
  Rationale: reviews aren't confidential, but an *unconfirmed* `bqLocationName`
  match could surface the wrong location's reviews; the confirmed gate prevents
  that and keeps behavior consistent with the financial cards.
- Requires a non-null `bqLocationName`; looks it up in the summary map.
- Returns `LocationReviewSummary` or `null`.

### 3. Component — `LocationReviewsPanel.tsx`

Location: `src/components/kpi/LocationReviewsPanel.tsx`.

Two-column layout (stacks to one column under ~720px):

- **Left (summary):** large numeric rating (e.g. `4.84`), a star row rounded to
  the nearest 0.5 for display, total review count, and a 5-row distribution
  histogram (one bar per star level, width = share of total, with a percentage
  label).
- **Right (featured review):** "Top review" label, reviewer initial avatar,
  name, date, star row, the comment text, and an "Owner replied" pill when
  `ownerReplied` is true.

Styling uses Montserrat and the `--hs-color-*` brand tokens (not hard-coded
hex). Filled stars use the warm `--hs-color-warning` amber token; empty stars
use `--hs-color-border-strong`.

### 4. Integration point — `KpiSection`

- `KpiSection` (`src/components/kpi/KpiSection.tsx`) calls `fetchLocationReviews()`
  alongside the existing revenue/membership fetches for single-location
  listings, and renders `LocationReviewsPanel` directly below `LocationKpiCards`.
- Territory and bundle listings: panel not rendered (same exclusion the KPI
  cards already apply).

## States & edge cases

- **No render:** if the gate fails, `bqLocationName` is null, the BigQuery client
  is null, or the location has zero review rows, the panel does not render at
  all (no placeholder card — the KPI section already communicates "not
  connected" for the broader section).
- **No featured review:** if aggregates exist but no comment-bearing review
  qualifies, render the summary + distribution and omit the featured-review
  column gracefully.
- **Star rounding:** numeric average shown verbatim to two decimals; the visual
  star row rounds to the nearest 0.5.
- **Null location names:** excluded in SQL.

## Scope guardrails

- Hello Sugar only: enforced implicitly — only owner-directory locations resolve
  a `bqLocationName`; competitors never do.
- No negative review text anywhere: the featured pick is highest-rating-first,
  and the distribution shows counts only.

## Testing

- **Query/aggregation:** unit-test the featured-review selection ordering
  (rating → length window → replied → recency) and the relax-on-empty-window
  fallback, using fixture rows.
- **Gating:** `fetchLocationReviews()` returns null when the gate fails, when
  `bqLocationName` is null, and when the location is absent from the map; returns
  the summary when all conditions pass.
- **Component:** renders the summary + distribution + featured review with data;
  renders summary-only when `featured` is null; renders nothing when the fetch
  returns null. Distribution bar widths reflect counts.
- Follow whatever test conventions the existing KPI code uses.

## Files touched

| File | Change |
| --- | --- |
| `src/lib/bigquery/queries.ts` | Add `getReviewSummaryByLocation()` + `LocationReviewSummary` type |
| `src/lib/kpi/fetch.ts` | Add `fetchLocationReviews()` |
| `src/components/kpi/LocationReviewsPanel.tsx` | New component |
| `src/components/kpi/KpiSection.tsx` | Fetch reviews + render the panel |
| (tests) | Cover query selection logic, gating, and component states |
