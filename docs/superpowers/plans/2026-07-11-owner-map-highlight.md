# Owner Map Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight the signed-in owner's locations in brand green on the /browse map and let them click through to a per-location financials/details page.

**Architecture:** Ownership is computed server-side in the browse route (session → owned `owner_locations` ids + owned active-listing ids) and passed to the client as two ID arrays — the shared 5-minute map caches stay owner-agnostic and PII-free. `MapView` recolors matching dots green (same size) and adds navigation on owned unlisted dots to a new owner-gated detail page at `/account/locations/[id]`, which reuses the existing KPI components behind a new owner-scoped access rule.

**Tech Stack:** Next.js App Router (this repo's version — see constraints), NextAuth v5, Drizzle/Neon, MapTiler SDK, nuqs, vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-owner-map-highlight-design.md`

## Global Constraints

- Branch: `feat/owner-map-highlight` (already created from `origin/main`). PR against `origin/main`. **Never merge to main** — the user merges the PR themselves.
- **This is NOT the Next.js you know** (AGENTS.md): before writing any page/route code, read the relevant guide in `node_modules/next/dist/docs/`. Route `params` is a **Promise** — mirror `src/app/listings/[id]/page.tsx:20-39`.
- Highlight color is brand success green `#3F7D5B` (`--color-success`); hover-strong is `#33654A` (`--color-green-700`). Dots keep their existing 16px size — color only.
- Do NOT modify `canFetchLiveData` in `src/lib/kpi/access.ts`, and do NOT add owner identity/PII to the shared caches in `src/lib/hs-locations-query.ts` (DEBT-024).
- Windows dev machine: do NOT run `next build` (dev-server lock) and NEVER run `npm run dev`. Per-task gate is `npx tsc --noEmit` + the task's vitest command. `npm run lint` is broken pre-existing — ignore it.
- Tests: `npx vitest run <path>` for a single file; `npm test` for the suite. Test files live in `src/__tests__/`.
- Double quotes / no semicolons in `src/lib` + `src/components/browse` files; single quotes in `src/components/kpi` + `src/app/listings` files — match each file's existing style.

---

### Task 1: Pure ownership-matching helper

**Files:**
- Create: `src/lib/owner-map/ownership.ts`
- Test: `src/__tests__/owner-map/ownership.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces:
  - `interface MapOwnership { ownedListingIds: string[]; ownedHsLocationIds: string[] }`
  - `interface ListingOwnershipRow { listingId: string; sellerId: string; bqLocationName: string | null; dataMappingStatus: string | null }`
  - `ownedBqNameSet(locations: { resolvedBqLocationName: string | null }[]): Set<string>`
  - `computeOwnedListingIds(rows: ListingOwnershipRow[], userId: string, ownedBqNames: Set<string>): string[]`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/owner-map/ownership.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { computeOwnedListingIds, ownedBqNameSet } from "@/lib/owner-map/ownership"

describe("ownedBqNameSet", () => {
  it("collects non-null resolved names and drops nulls", () => {
    const set = ownedBqNameSet([
      { resolvedBqLocationName: "Sugar House" },
      { resolvedBqLocationName: null },
      { resolvedBqLocationName: "Draper" },
    ])
    expect(set).toEqual(new Set(["Sugar House", "Draper"]))
  })
})

describe("computeOwnedListingIds", () => {
  const owned = new Set(["Sugar House"])

  it("matches a listing the user is selling", () => {
    const rows = [
      { listingId: "l1", sellerId: "u1", bqLocationName: null, dataMappingStatus: null },
    ]
    expect(computeOwnedListingIds(rows, "u1", new Set())).toEqual(["l1"])
  })

  it("matches a listing whose confirmed location bq name is owned", () => {
    const rows = [
      { listingId: "l1", sellerId: "other", bqLocationName: "Sugar House", dataMappingStatus: "confirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", owned)).toEqual(["l1"])
  })

  it("ignores unconfirmed mappings even when the bq name is owned", () => {
    const rows = [
      { listingId: "l1", sellerId: "other", bqLocationName: "Sugar House", dataMappingStatus: "unconfirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", owned)).toEqual([])
  })

  it("ignores null bq names and non-owned names", () => {
    const rows = [
      { listingId: "l1", sellerId: "other", bqLocationName: null, dataMappingStatus: "confirmed" },
      { listingId: "l2", sellerId: "other", bqLocationName: "Elsewhere", dataMappingStatus: "confirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", owned)).toEqual([])
  })

  it("returns a bundle listing once even when several of its locations match", () => {
    const rows = [
      { listingId: "l1", sellerId: "u1", bqLocationName: "Sugar House", dataMappingStatus: "confirmed" },
      { listingId: "l1", sellerId: "u1", bqLocationName: "Draper", dataMappingStatus: "confirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", owned)).toEqual(["l1"])
  })

  it("returns [] for a user with no ownership signals", () => {
    const rows = [
      { listingId: "l1", sellerId: "other", bqLocationName: "Sugar House", dataMappingStatus: "confirmed" },
    ]
    expect(computeOwnedListingIds(rows, "u1", new Set())).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/owner-map/ownership.test.ts`
Expected: FAIL — cannot resolve `@/lib/owner-map/ownership`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/owner-map/ownership.ts`:

```ts
/**
 * Pure ownership matching for the /browse map "your locations" highlight.
 * Server code computes these per-request from the session; the shared map
 * caches stay owner-agnostic (DEBT-024), so nothing here touches the DB.
 */

/** ID sets handed to the client to mark map dots as "yours". */
export interface MapOwnership {
  ownedListingIds: string[]
  ownedHsLocationIds: string[]
}

export const EMPTY_MAP_OWNERSHIP: MapOwnership = {
  ownedListingIds: [],
  ownedHsLocationIds: [],
}

/** One row per (active listing × location) from the browse ownership query. */
export interface ListingOwnershipRow {
  listingId: string
  sellerId: string
  bqLocationName: string | null
  dataMappingStatus: string | null
}

/** The owner's financial join keys — non-null resolved BigQuery names. */
export function ownedBqNameSet(
  locations: { resolvedBqLocationName: string | null }[]
): Set<string> {
  return new Set(
    locations
      .map((l) => l.resolvedBqLocationName)
      .filter((n): n is string => n !== null)
  )
}

/**
 * A listing is "mine" if I am its seller, or any of its locations has a
 * CONFIRMED mapping to a BigQuery name I own (unconfirmed suggestions are
 * name-match guesses and must not drive ownership).
 */
export function computeOwnedListingIds(
  rows: ListingOwnershipRow[],
  userId: string,
  ownedBqNames: Set<string>
): string[] {
  const owned = new Set<string>()
  for (const r of rows) {
    if (r.sellerId === userId) {
      owned.add(r.listingId)
      continue
    }
    if (
      r.bqLocationName &&
      r.dataMappingStatus === "confirmed" &&
      ownedBqNames.has(r.bqLocationName)
    ) {
      owned.add(r.listingId)
    }
  }
  return [...owned]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/owner-map/ownership.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/owner-map/ownership.ts src/__tests__/owner-map/ownership.test.ts
git commit -m "feat(owner-map): pure ownership-matching helper"
```

---

### Task 2: Owner-scoped KPI access rule

**Files:**
- Modify: `src/lib/kpi/access.ts` (currently 4 lines — append below `canFetchLiveData`)
- Test: `src/__tests__/kpi/owner-access.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `canOwnerFetchLiveData(rowOwnerIdentifier: string, sessionOwnerIdentifier: string | null | undefined, resolvedBqLocationName: string | null): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/kpi/owner-access.test.ts` (style mirrors `src/__tests__/kpi/access-control.test.ts`):

```ts
import { describe, it, expect } from "vitest"
import { canOwnerFetchLiveData } from "@/lib/kpi/access"

describe("canOwnerFetchLiveData", () => {
  it("allows the row's owner when a resolved BigQuery name exists", () => {
    expect(canOwnerFetchLiveData("owner-1", "owner-1", "Sugar House")).toBe(true)
  })
  it.each([
    ["different owner", "owner-1", "owner-2", "Sugar House"],
    ["no session owner (null)", "owner-1", null, "Sugar House"],
    ["no session owner (undefined)", "owner-1", undefined, "Sugar House"],
    ["empty session owner", "owner-1", "", "Sugar House"],
    ["no resolved bq name", "owner-1", "owner-1", null],
  ] as const)("blocks %s", (_label, row, session, bq) => {
    expect(canOwnerFetchLiveData(row, session, bq)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/owner-access.test.ts`
Expected: FAIL — `canOwnerFetchLiveData` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/kpi/access.ts` (leave `canFetchLiveData` untouched):

```ts
/**
 * Owner-scoped variant (parallel to the listing gate above, which is
 * unchanged): a linked owner may see live data for an owner_locations row
 * they own that has a resolved BigQuery name. The row must come from a
 * server-side owner-scoped query — never trust client-supplied identifiers.
 */
export function canOwnerFetchLiveData(
  rowOwnerIdentifier: string,
  sessionOwnerIdentifier: string | null | undefined,
  resolvedBqLocationName: string | null
): boolean {
  return (
    !!sessionOwnerIdentifier &&
    rowOwnerIdentifier === sessionOwnerIdentifier &&
    !!resolvedBqLocationName
  )
}
```

- [ ] **Step 4: Run tests to verify both access files pass**

Run: `npx vitest run src/__tests__/kpi/owner-access.test.ts src/__tests__/kpi/access-control.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/kpi/access.ts src/__tests__/kpi/owner-access.test.ts
git commit -m "feat(kpi): owner-scoped live-data access rule"
```

---

### Task 3: Owner location lookup + owner KPI fetch

**Files:**
- Create: `src/lib/owner-directory/my-location.ts`
- Modify: `src/lib/kpi/fetch.ts` (append a new export at the end)
- Test: `src/__tests__/owner-directory/my-location.test.ts`
- Test: `src/__tests__/kpi/owner-fetch.test.ts`

**Interfaces:**
- Consumes: `getMyOwnerLocations()` from `@/lib/owner-directory/data` (returns `{ ownerIdentifier: string | null; locations: OwnerLocation[] }`, already query-scoped to the session user and excludes Unknown Owner); `canOwnerFetchLiveData` from Task 2; existing BigQuery map getters in `@/lib/bigquery/queries`.
- Produces:
  - `getMyOwnerLocationById(id: string): Promise<OwnerLocation | null>` — the row only if the signed-in user owns it.
  - `fetchOwnerLocationKpis(args: { rowOwnerIdentifier: string; sessionOwnerIdentifier: string | null; bqLocationName: string | null }): Promise<{ netSales: KpiMetric | null; membership: KpiMetric | null; reviews: LocationReviewSummary | null }>`

- [ ] **Step 1: Read the repo's KPI test mock preamble**

Read `src/__tests__/kpi/revenue.test.ts` and `src/__tests__/listings/seller-locations.test.ts` to confirm the exact `vi.mock` preamble used for `server-only`, `@/lib/bigquery/queries`, and (if present there) `next/cache` / `@/lib/env`. Use the SAME preamble style in the new tests below — if `src/lib/kpi/fetch.ts` fails to import in vitest without a `next/cache` or `@/lib/env` mock, copy the working mocks from `revenue.test.ts` verbatim.

- [ ] **Step 2: Write the failing tests**

Create `src/__tests__/owner-directory/my-location.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { OwnerLocation } from "@/db/schema"

vi.mock("server-only", () => ({}))

const getMyOwnerLocations = vi.fn()
vi.mock("@/lib/owner-directory/data", () => ({ getMyOwnerLocations }))

function ownerLoc(over: Partial<OwnerLocation>): OwnerLocation {
  return {
    id: "ol-1",
    ownerIdentifier: "owner-1",
    ownerName: null,
    ownerContactEmail: null,
    blvdLocationName: "Sugar House",
    blvdLocationNumber: null,
    locationAddress: null,
    actualSuiteGoDate: null,
    suiteClosedDate: null,
    actualFlagshipGoDate: null,
    flagshipClosedDate: null,
    ownerContactEmailNormalized: null,
    resolvedBqLocationName: null,
    blvdMatchMethod: "unmatched",
    blvdMatchConfidence: "none",
    syncedAt: new Date(),
    latitude: null,
    longitude: null,
    geocodedAt: null,
    ...over,
  }
}

describe("getMyOwnerLocationById", () => {
  beforeEach(() => {
    vi.resetModules()
    getMyOwnerLocations.mockReset()
  })

  it("returns the row when the signed-in owner owns it", async () => {
    getMyOwnerLocations.mockResolvedValue({
      ownerIdentifier: "owner-1",
      locations: [ownerLoc({ id: "a" }), ownerLoc({ id: "b" })],
    })
    const { getMyOwnerLocationById } = await import("@/lib/owner-directory/my-location")
    const row = await getMyOwnerLocationById("b")
    expect(row?.id).toBe("b")
  })

  it("returns null for an id outside the owner's scoped rows (someone else's location)", async () => {
    getMyOwnerLocations.mockResolvedValue({
      ownerIdentifier: "owner-1",
      locations: [ownerLoc({ id: "a" })],
    })
    const { getMyOwnerLocationById } = await import("@/lib/owner-directory/my-location")
    expect(await getMyOwnerLocationById("not-mine")).toBeNull()
  })

  it("returns null for an unlinked user (no owned rows)", async () => {
    getMyOwnerLocations.mockResolvedValue({ ownerIdentifier: null, locations: [] })
    const { getMyOwnerLocationById } = await import("@/lib/owner-directory/my-location")
    expect(await getMyOwnerLocationById("a")).toBeNull()
  })
})
```

Create `src/__tests__/kpi/owner-fetch.test.ts` (adjust the mock preamble per Step 1 if `revenue.test.ts` mocks more modules):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const getNetSalesByLocation = vi.fn()
const getMcrByLocation = vi.fn()
const getMcrTrendByLocation = vi.fn()
const getReviewSummaryByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({
  getNetSalesByLocation,
  getMcrByLocation,
  getMcrTrendByLocation,
  getReviewSummaryByLocation,
}))

describe("fetchOwnerLocationKpis", () => {
  beforeEach(() => {
    vi.resetModules()
    getNetSalesByLocation.mockReset().mockResolvedValue(new Map())
    getMcrByLocation.mockReset().mockResolvedValue(new Map())
    getMcrTrendByLocation.mockReset().mockResolvedValue(new Map())
    getReviewSummaryByLocation.mockReset().mockResolvedValue(new Map())
  })

  it("returns all-null without touching BigQuery when the session owner does not own the row", async () => {
    const { fetchOwnerLocationKpis } = await import("@/lib/kpi/fetch")
    const out = await fetchOwnerLocationKpis({
      rowOwnerIdentifier: "owner-1",
      sessionOwnerIdentifier: "owner-2",
      bqLocationName: "Sugar House",
    })
    expect(out).toEqual({ netSales: null, membership: null, reviews: null })
    expect(getNetSalesByLocation).not.toHaveBeenCalled()
  })

  it("returns all-null when the row has no resolved BigQuery name", async () => {
    const { fetchOwnerLocationKpis } = await import("@/lib/kpi/fetch")
    const out = await fetchOwnerLocationKpis({
      rowOwnerIdentifier: "owner-1",
      sessionOwnerIdentifier: "owner-1",
      bqLocationName: null,
    })
    expect(out).toEqual({ netSales: null, membership: null, reviews: null })
    expect(getNetSalesByLocation).not.toHaveBeenCalled()
  })

  it("builds Net Sales + MCR metrics and reviews for the owner's connected location", async () => {
    getNetSalesByLocation.mockResolvedValue(
      new Map([["Sugar House", { totalCents: 42_500_000, trend: [{ month: "2026-06", value: 35_000 }] }]])
    )
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))
    getMcrTrendByLocation.mockResolvedValue(
      new Map([["Sugar House", [{ month: "2026-06", value: 34.5 }]]])
    )
    getReviewSummaryByLocation.mockResolvedValue(
      new Map([["Sugar House", { averageRating: 4.8, reviewCount: 120 }]])
    )

    const { fetchOwnerLocationKpis } = await import("@/lib/kpi/fetch")
    const out = await fetchOwnerLocationKpis({
      rowOwnerIdentifier: "owner-1",
      sessionOwnerIdentifier: "owner-1",
      bqLocationName: "Sugar House",
    })

    expect(out.netSales).not.toBeNull()
    expect(out.membership).not.toBeNull()
    expect(out.reviews).toEqual({ averageRating: 4.8, reviewCount: 120 })
  })

  it("falls back to a TTM point for MCR when no monthly trend exists", async () => {
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))
    // trend map stays empty
    const { fetchOwnerLocationKpis } = await import("@/lib/kpi/fetch")
    const out = await fetchOwnerLocationKpis({
      rowOwnerIdentifier: "owner-1",
      sessionOwnerIdentifier: "owner-1",
      bqLocationName: "Sugar House",
    })
    expect(out.membership).not.toBeNull()
    expect(out.netSales).toBeNull() // no net-sales entry for this location
  })
})
```

Note: if the `reviews` object shape in `@/lib/bigquery/queries` (`LocationReviewSummary`) has different fields, read its definition and use a valid literal — the assertion only needs to round-trip whatever the map holds.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/owner-directory/my-location.test.ts src/__tests__/kpi/owner-fetch.test.ts`
Expected: FAIL — missing module / missing export.

- [ ] **Step 4: Write the implementations**

Create `src/lib/owner-directory/my-location.ts`:

```ts
import "server-only"
import type { OwnerLocation } from "@/db/schema"
import { getMyOwnerLocations } from "./data"

/**
 * The owner_locations row ONLY if the signed-in user owns it, else null so
 * the caller can 404. Delegates to getMyOwnerLocations, which is query-scoped
 * to the session user's owner_identifier and never returns Unknown Owner —
 * so a mismatched id can never leak another owner's row.
 */
export async function getMyOwnerLocationById(id: string): Promise<OwnerLocation | null> {
  const { locations } = await getMyOwnerLocations()
  return locations.find((l) => l.id === id) ?? null
}
```

Append to `src/lib/kpi/fetch.ts` (after `fetchBundleLocationKpis`; `canOwnerFetchLiveData` joins the existing `canFetchLiveData` import from `./access`):

```ts
/**
 * Owner-scoped KPI fetch for /account/locations/[id] — the owner-gate
 * counterpart of the listing-gated fetchers above. The caller passes the
 * ownerIdentifier from a server-verified owner_locations row plus the
 * session's ownerIdentifier; anything short of an exact owner match with a
 * resolved BigQuery name returns all-null ("not connected" rendering).
 */
export async function fetchOwnerLocationKpis(args: {
  rowOwnerIdentifier: string
  sessionOwnerIdentifier: string | null
  bqLocationName: string | null
}): Promise<{
  netSales: KpiMetric | null
  membership: KpiMetric | null
  reviews: LocationReviewSummary | null
}> {
  if (
    !canOwnerFetchLiveData(
      args.rowOwnerIdentifier,
      args.sessionOwnerIdentifier,
      args.bqLocationName
    )
  ) {
    return { netSales: null, membership: null, reviews: null }
  }
  const bqName = args.bqLocationName as string

  const [netMap, mcrMap, mcrTrendMap, reviewMap] = await Promise.all([
    getNetSalesByLocation(),
    getMcrByLocation(),
    getMcrTrendByLocation(),
    getReviewSummaryByLocation(),
  ])

  const ns = netMap.get(bqName)
  const netSales = ns
    ? buildMetricFromTrend(ns.trend, { lastMonth: ns.totalCents / 100 })
    : null

  let membership: KpiMetric | null = null
  const pct = mcrMap.get(bqName)
  if (pct !== undefined) {
    const points = mcrTrendMap.get(bqName) ?? []
    const trend = points.length > 0 ? points : [{ month: "TTM", value: pct }]
    membership = buildMetricFromTrend(trend)
  }

  return { netSales, membership, reviews: reviewMap.get(bqName) ?? null }
}
```

Update the import line in `src/lib/kpi/fetch.ts` from `import { canFetchLiveData } from "./access"` to `import { canFetchLiveData, canOwnerFetchLiveData } from "./access"`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/owner-directory/my-location.test.ts src/__tests__/kpi/owner-fetch.test.ts src/__tests__/kpi`
Expected: PASS (new files + all existing kpi tests stay green).

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/owner-directory/my-location.ts src/lib/kpi/fetch.ts src/__tests__/owner-directory/my-location.test.ts src/__tests__/kpi/owner-fetch.test.ts
git commit -m "feat(kpi): owner-scoped location lookup and KPI fetch"
```

---

### Task 4: Map dot highlighting + owned-dot popup/click (MapView)

**Files:**
- Modify: `src/lib/brand-colors.ts`
- Modify: `src/components/browse/hs-location-popup.ts`
- Modify: `src/components/browse/MapView.tsx`
- Test: `src/__tests__/hs-location-popup.test.ts` (extend, don't break existing cases)

**Interfaces:**
- Consumes: `BRAND` (gains `success`/`successStrong`), `UnlistedHsLocation`.
- Produces (consumed by Task 6):
  - `MapViewProps` gains: `ownedListingIds?: string[]`, `ownedHsLocationIds?: string[]`, `showMyLocations?: boolean` (default `true`), `onHsLocationClick?: (id: string) => void`.
  - `hsLocationPopupHtml(loc: UnlistedHsLocation, owned?: boolean): string` (default `false` keeps every existing call site working).

- [ ] **Step 1: Extend the popup test (failing first)**

Add to `src/__tests__/hs-location-popup.test.ts` (keep all existing tests; match the file's existing fixture style — read it first):

```ts
it("owned variant shows the yours badge and a details CTA", () => {
  const html = hsLocationPopupHtml(loc, true)
  expect(html).toContain("Your location")
  expect(html).toContain("View details")
})

it("default variant is unchanged (no CTA, not-for-sale badge)", () => {
  const html = hsLocationPopupHtml(loc)
  expect(html).toContain("not for sale")
  expect(html).not.toContain("View details")
})
```

Run: `npx vitest run src/__tests__/hs-location-popup.test.ts` — expected FAIL on the owned-variant test.

- [ ] **Step 2: Add the brand colors**

In `src/lib/brand-colors.ts`, add to the `BRAND` object (keep the file's comment convention — values must match `src/app/globals.css` tokens):

```ts
  /** --color-success / --color-green-600 — "your location" map markers */
  success: '#3F7D5B',
  /** --color-green-700 — success hover/active on map markers */
  successStrong: '#33654A',
```

- [ ] **Step 3: Owned variant of the HS-location popup**

In `src/components/browse/hs-location-popup.ts`, change the signature to `hsLocationPopupHtml(loc: UnlistedHsLocation, owned = false)` and make the badge + CTA conditional. Full updated body:

```ts
export function hsLocationPopupHtml(loc: UnlistedHsLocation, owned = false): string {
  const place = [loc.city, loc.state]
    .filter((s): s is string => !!s)
    .map(escapeHtml)
    .join(", ")

  const badge = owned
    ? `<div style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:#DBEBE1;color:#3F7D5B;padding:2px 8px;border-radius:999px;margin-bottom:6px;">Your location</div>`
    : `<div style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:#EEE2DA;color:#8F7067;padding:2px 8px;border-radius:999px;margin-bottom:6px;">Hello Sugar · not for sale</div>`

  const placeLine = place
    ? `<div style="font-size:12px;color:#8F7067;margin-top:6px;">${place}</div>`
    : ""

  const sinceLine =
    loc.openedSince != null
      ? `<div style="font-size:12px;color:#8F7067;margin-top:6px;">Open since ${loc.openedSince}</div>`
      : ""

  const cta = owned
    ? `<div style="margin-top:8px;font-size:13px;color:#3F7D5B;font-weight:500;">Click to view details →</div>`
    : ""

  return `
    <div style="font-family:'Montserrat',system-ui,sans-serif;padding:4px 4px 2px;max-width:220px;">
      ${badge}
      <div style="font-size:15px;font-weight:700;color:#1F1917;line-height:1.25;">${escapeHtml(loc.name)}</div>
      ${placeLine}
      ${sinceLine}
      ${cta}
    </div>`
}
```

(Keep the file's doc comment; note in it that the owned variant is still non-PII — it only reflects what the signed-in owner already knows.)

Run: `npx vitest run src/__tests__/hs-location-popup.test.ts` — expected PASS.

- [ ] **Step 4: MapView — props and refs**

In `src/components/browse/MapView.tsx`:

Add to `MapViewProps` (after `showHsLocations?: boolean`):

```ts
  // Ids of listings / unlisted HS locations the signed-in user owns — rendered
  // in brand green. Same size/shape as their layer; color is the only change.
  ownedListingIds?: string[]
  ownedHsLocationIds?: string[]
  // Legend toggle: when false, owned dots render exactly like non-owned dots.
  showMyLocations?: boolean
  // Click handler for OWNED unlisted HS dots only (navigates to the owner
  // detail page). Non-owned HS dots keep the pin-popup behavior.
  onHsLocationClick?: (id: string) => void
```

Add the defaults in the destructuring: `ownedListingIds = []`, `ownedHsLocationIds = []`, `showMyLocations = true`, `onHsLocationClick`.

Add a ref next to `onListingClickRef` (same pattern):

```ts
  const onHsLocationClickRef = useRef(onHsLocationClick)
  onHsLocationClickRef.current = onHsLocationClick
```

- [ ] **Step 5: MapView — listing dots go green when owned**

In the listing-markers effect (`addMarkers`), before the loop add:

```ts
      const ownedListingSet = new Set(ownedListingIds)
```

Inside the loop, replace the hard-coded crimson styling with dataset-driven colors (this also future-proofs the hover effect):

```ts
        const isMine = showMyLocations && ownedListingSet.has(listing.id)
        const baseColor = isMine ? BRAND.success : BRAND.crimson
        const hoverColor = isMine ? BRAND.successStrong : BRAND.crimsonStrong

        const inner = document.createElement("div")
        inner.className = "map-marker"
        inner.dataset.baseColor = baseColor
        inner.dataset.hoverColor = hoverColor
        inner.style.cssText = `
          width: 16px;
          height: 16px;
          background-color: ${baseColor};
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          transition: transform 0.15s ease, background-color 0.15s ease;
        `
```

Update the effect's dependency array from `[listings, onHover, showListings]` to:

```ts
  }, [listings, onHover, showListings, ownedListingIds.join(","), showMyLocations])
```

(The joined-string dep matches the existing `savedPlaceIds.join(",")` convention in the competitor effect.)

Update the hovered-marker effect (the one keying off `hoveredId` for listing markers) to read the dataset instead of hard-coded crimson:

```ts
      if (id === hoveredId) {
        inner.style.transform = "scale(1.3)"
        inner.style.backgroundColor = inner.dataset.hoverColor ?? BRAND.crimsonStrong
        el.style.zIndex = "10"
      } else {
        inner.style.transform = "scale(1)"
        inner.style.backgroundColor = inner.dataset.baseColor ?? BRAND.crimson
        el.style.zIndex = ""
      }
```

- [ ] **Step 6: MapView — owned HS dots: green + navigate on click**

In the HS-locations effect, before the loop add:

```ts
      const ownedHsSet = new Set(ownedHsLocationIds)
```

Inside the loop, derive ownership and use it for color, popup, and click:

```ts
        const isMine = showMyLocations && ownedHsSet.has(loc.id)

        const inner = document.createElement("div")
        inner.style.cssText = `
          width: 16px;
          height: 16px;
          background-color: ${isMine ? BRAND.success : BRAND.taupe};
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          transition: transform 0.15s ease;
        `
```

Pass the flag to the popup: `.setHTML(hsLocationPopupHtml(loc, isMine))`.

Replace the click handler so owned dots navigate and non-owned dots keep the pin behavior exactly as-is:

```ts
        // Owned dots navigate to the owner detail page; everyone else's keep
        // the pin-the-popup behavior. stopPropagation (both paths) keeps the
        // map's closeOnClick from immediately dismissing a pinned popup.
        el.addEventListener("click", (e) => {
          e.stopPropagation()
          if (isMine && onHsLocationClickRef.current) {
            popup.remove()
            onHsLocationClickRef.current(loc.id)
            return
          }
          pinned = true
          popup.addTo(m)
        })
```

Update the effect's dependency array from `[hsLocations, showHsLocations]` to:

```ts
  }, [hsLocations, showHsLocations, ownedHsLocationIds.join(","), showMyLocations])
```

- [ ] **Step 7: Verify and commit**

```bash
npx vitest run src/__tests__/hs-location-popup.test.ts
npx tsc --noEmit
git add src/lib/brand-colors.ts src/components/browse/hs-location-popup.ts src/components/browse/MapView.tsx src/__tests__/hs-location-popup.test.ts
git commit -m "feat(map): render owned locations in brand green with owner click-through"
```

Note: MapView has no unit tests (DOM + MapTiler); it is exercised in Task 8's end-to-end verification.

---

### Task 5: URL state + legend row

**Files:**
- Modify: `src/components/browse/FilterBar.tsx` (the `useListingFilters` hook, lines ~36-54)
- Modify: `src/components/browse/MapLegend.tsx`

**Interfaces:**
- Consumes: nuqs parsers already imported in FilterBar.
- Produces (consumed by Task 6): `filters.showMyLocations: boolean` on `useListingFilters()`; `MapLegend` prop `hasOwnedLocations?: boolean` (default `false`).

- [ ] **Step 1: Add the URL-state boolean**

In `src/components/browse/FilterBar.tsx`, inside `useQueryStates`, after `showHsLocations`:

```ts
    showMyLocations: parseAsBoolean.withDefault(true),
```

- [ ] **Step 2: Add the legend row**

In `src/components/browse/MapLegend.tsx`, give the component a prop and render the row only for owners. Update the signature:

```tsx
/** Collapsible on-map key: swatch rows that toggle their map layer. */
export function MapLegend({ hasOwnedLocations = false }: { hasOwnedLocations?: boolean }) {
```

Insert a "Your locations" row ABOVE the "For sale" row (the viewer's own layer reads first). Toggling it off does not hide dots — it reverts them to their normal layer color (the listings/HS rows still control visibility), hence the distinct title text:

```tsx
          {hasOwnedLocations && (
            <ToggleRow
              label="Your locations"
              active={filters.showMyLocations}
              onClick={() => setFilters({ showMyLocations: !filters.showMyLocations })}
              swatch={<Dot color="var(--color-success)" />}
            />
          )}
```

`ToggleRow`'s `title` attribute says "Show/Hide your locations on the map" — acceptable shorthand; the dots don't disappear, they lose the green. If you want it exact, extend `ToggleRow` with an optional `titleOverride?: string` prop and pass `titleOverride={filters.showMyLocations ? "Show your locations in the normal colors" : "Highlight your locations in green"}` — do this only if it stays a one-liner at each end.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run src/__tests__
git add src/components/browse/FilterBar.tsx src/components/browse/MapLegend.tsx
git commit -m "feat(browse): your-locations legend row and URL toggle"
```

(Full-suite run guards against FilterBar/legend regressions — `browse-list-sections` and `radius-search-hint` tests touch this area.)

---

### Task 6: Server ownership wiring (browse route → BrowsePage → MapView)

**Files:**
- Create: `src/lib/owner-map/data.ts`
- Modify: `src/app/browse/page.tsx`
- Modify: `src/components/browse/BrowsePage.tsx`

**Interfaces:**
- Consumes: `MapOwnership`, `EMPTY_MAP_OWNERSHIP`, `ownedBqNameSet`, `computeOwnedListingIds` (Task 1); `getMyOwnerLocations` (existing); MapView/MapLegend props (Tasks 4–5); `filters.showMyLocations` (Task 5).
- Produces: `getMyMapOwnership(): Promise<MapOwnership>`; `BrowsePageProps.mapOwnership?: MapOwnership`.

- [ ] **Step 1: Server data function**

Create `src/lib/owner-map/data.ts`:

```ts
import "server-only"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/db"
import { listings, listingLocations } from "@/db/schema/listings"
import { getMyOwnerLocations } from "@/lib/owner-directory/data"
import {
  computeOwnedListingIds,
  ownedBqNameSet,
  EMPTY_MAP_OWNERSHIP,
  type MapOwnership,
} from "./ownership"

/**
 * Per-request ownership for the /browse map: which active-listing dots and
 * which unlisted HS dots belong to the signed-in user. Computed from the
 * session here so the shared, owner-agnostic map caches never carry owner
 * identity (DEBT-024). Resilient like the other map sources — any failure
 * renders the map without highlights rather than blocking the page.
 */
export async function getMyMapOwnership(): Promise<MapOwnership> {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return EMPTY_MAP_OWNERSHIP

    const { locations } = await getMyOwnerLocations()

    const rows = await db
      .select({
        listingId: listings.id,
        sellerId: listings.sellerId,
        bqLocationName: listingLocations.bqLocationName,
        dataMappingStatus: listingLocations.dataMappingStatus,
      })
      .from(listings)
      .leftJoin(listingLocations, eq(listingLocations.listingId, listings.id))
      .where(eq(listings.status, "active"))

    return {
      ownedListingIds: computeOwnedListingIds(rows, userId, ownedBqNameSet(locations)),
      ownedHsLocationIds: locations.map((l) => l.id),
    }
  } catch (err) {
    console.error("getMyMapOwnership failed; rendering map without owner highlights", err)
    return EMPTY_MAP_OWNERSHIP
  }
}
```

- [ ] **Step 2: Browse route fetches ownership**

In `src/app/browse/page.tsx`:
- Add imports: `import { getMyMapOwnership } from "@/lib/owner-map/data"`.
- Add `getMyMapOwnership()` as a fifth member of the existing `Promise.all` (destructure as `mapOwnership`).
- Pass it to the page: `<BrowsePage ... mapOwnership={mapOwnership} />`.

- [ ] **Step 3: BrowsePage plumbs ownership to map + legend**

In `src/components/browse/BrowsePage.tsx`:

Imports:

```ts
import { EMPTY_MAP_OWNERSHIP, type MapOwnership } from "@/lib/owner-map/ownership"
```

Props: add `mapOwnership?: MapOwnership` to `BrowsePageProps` and `mapOwnership = EMPTY_MAP_OWNERSHIP` to the destructuring.

State/handlers (near the existing `showHsLocations` read and `handleListingClick`):

```ts
  const showMyLocations = rawFilters.showMyLocations

  // Owned unlisted HS dot → owner detail page. Memoized like handleListingClick
  // so the MapView marker effect doesn't rebuild every render.
  const handleHsLocationClick = useCallback(
    (id: string) => {
      router.push(`/account/locations/${id}`)
    },
    [router]
  )

  // Legend row appears only when at least one owned location is actually on
  // the map (owned ids that didn't survive geocoding/open/unlisted filters
  // shouldn't summon the row).
  const hasOwnedOnMap = useMemo(() => {
    const listingIds = new Set(mapOwnership.ownedListingIds)
    const hsIds = new Set(mapOwnership.ownedHsLocationIds)
    return (
      initialListings.some((l) => listingIds.has(l.id)) ||
      hsLocations.some((l) => hsIds.has(l.id))
    )
  }, [mapOwnership, initialListings, hsLocations])
```

MapView call — add the new props:

```tsx
              <MapView
                ...existing props unchanged...
                ownedListingIds={mapOwnership.ownedListingIds}
                ownedHsLocationIds={mapOwnership.ownedHsLocationIds}
                showMyLocations={showMyLocations}
                onHsLocationClick={handleHsLocationClick}
              />
```

Legend call: `<MapLegend hasOwnedLocations={hasOwnedOnMap} />`.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run src/__tests__
git add src/lib/owner-map/data.ts src/app/browse/page.tsx src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): wire per-session map ownership into MapView and legend"
```

---

### Task 7: Owner location detail page + list-page links

**Files:**
- Create: `src/app/account/locations/[id]/page.tsx`
- Modify: `src/app/account/locations/page.tsx` (link each card)

**Interfaces:**
- Consumes: `getMyOwnerLocationById` + `fetchOwnerLocationKpis` (Task 3); `deriveLocationStatus` (`@/lib/owner-directory/status`); `openedSinceYear` (`@/lib/hs-locations-filter`); `LocationKpiCards` + `LocationReviewsPanel` (`@/components/kpi/...`); `Badge`, `SiteHeader`.
- Produces: route `/account/locations/[id]` (owner-gated, 404 otherwise).

- [ ] **Step 1: Read the Next.js page-convention doc**

Per AGENTS.md, read the pages/dynamic-routes guide under `node_modules/next/dist/docs/` (find it with a glob) and confirm the `params: Promise<{ id: string }>` pattern used by `src/app/listings/[id]/page.tsx` is still the convention. Mirror that file.

- [ ] **Step 2: Create the detail page**

Create `src/app/account/locations/[id]/page.tsx`:

```tsx
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { getMyOwnerLocationById } from "@/lib/owner-directory/my-location"
import { deriveLocationStatus, type OverallStatus } from "@/lib/owner-directory/status"
import { openedSinceYear } from "@/lib/hs-locations-filter"
import { fetchOwnerLocationKpis } from "@/lib/kpi/fetch"
import { LocationKpiCards } from "@/components/kpi/LocationKpiCards"
import { LocationReviewsPanel } from "@/components/kpi/LocationReviewsPanel"
import { Badge } from "@/components/ui/Badge"
import { SiteHeader } from "@/components/layout/SiteHeader"

export const metadata = {
  title: "Location Details - Hello Sugar Marketplace",
}

const STATUS_VARIANT: Record<OverallStatus, "success" | "default" | "warning"> = {
  active: "success",
  closed: "default",
  pending: "warning",
}

export default async function OwnerLocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  // Owner gate: the lookup is scoped to the signed-in user's owner_identifier,
  // so any other user's location id (or an unknown id) 404s here.
  const loc = await getMyOwnerLocationById(id)
  if (!loc) {
    notFound()
  }

  const status = deriveLocationStatus(loc)
  const connected = loc.resolvedBqLocationName !== null
  const openedSince = openedSinceYear(loc)

  const { netSales, membership, reviews } = await fetchOwnerLocationKpis({
    rowOwnerIdentifier: loc.ownerIdentifier,
    sessionOwnerIdentifier: session.user.ownerIdentifier ?? null,
    bqLocationName: loc.resolvedBqLocationName,
  })

  return (
    <>
      <SiteHeader world="marketplace" title={loc.blvdLocationName} subtitle="Your location" />
      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-8">
        <Link
          href="/account/locations"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-hs-red-700 hover:text-hs-red-800"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          My Locations
        </Link>

        {/* Location details */}
        <section className="p-5 bg-white rounded-xl border border-gray-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-display font-semibold text-gray-900">
                {loc.blvdLocationName}
              </h1>
              {loc.locationAddress && (
                <p className="text-sm text-gray-500 mt-1">{loc.locationAddress}</p>
              )}
            </div>
            <Badge variant={STATUS_VARIANT[status.overall]} dot>
              {status.label}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
            {connected ? (
              <Badge variant="info" size="sm">Connected to financials</Badge>
            ) : (
              <Badge variant="outline" size="sm">Not yet connected</Badge>
            )}
            {loc.blvdLocationNumber && (
              <span className="text-xs text-gray-400">#{loc.blvdLocationNumber}</span>
            )}
            {openedSince != null && (
              <span className="text-xs text-gray-400">Open since {openedSince}</span>
            )}
          </div>
        </section>

        {/* Financials — same metrics the marketplace listing pages show */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Performance Data</h2>
          {connected ? (
            <>
              <LocationKpiCards netSales={netSales} membership={membership} />
              <LocationReviewsPanel reviews={reviews} />
            </>
          ) : (
            <p className="text-sm text-gray-500">
              This location isn&apos;t connected to financial data yet. An admin can
              connect it from the owner directory.
            </p>
          )}
        </section>
      </main>
    </>
  )
}
```

Note: `LocationKpiCards` renders "Not connected" placeholder cards on null metrics, which also covers the connected-but-absent-from-BigQuery case. Check `LocationReviewsPanel`'s null handling before relying on it (`src/components/kpi/LocationReviewsPanel.tsx`) — `KpiSection` passes it null today, so it must tolerate null; if it renders an unwanted empty state, wrap it in `{reviews && (...)}`.

- [ ] **Step 3: Link the My Locations cards**

In `src/app/account/locations/page.tsx`:
- Add `import Link from "next/link"`.
- Convert each card `<div key={loc.id} className="flex flex-col gap-3 p-4 bg-white rounded-xl border border-gray-200">` into a `<Link key={loc.id} href={`/account/locations/${loc.id}`} className="flex flex-col gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all">` (closing tag `</Link>`). Everything inside stays the same.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run src/__tests__
git add "src/app/account/locations/[id]/page.tsx" src/app/account/locations/page.tsx
git commit -m "feat(account): owner location detail page with financials"
```

---

### Task 8: Full verification + PR

**Files:** none new.

- [ ] **Step 1: Full gates**

```bash
npm test
npx tsc --noEmit
```

Expected: full suite green, no type errors. (Do NOT run `next build` if a dev server is running; do NOT start one.)

- [ ] **Step 2: End-to-end verification (superpowers:verification-before-completion + verify skill)**

Drive the real flow, not just tests. Ask the user to run the dev server themselves if one isn't already running (never auto-start it). Verify with a linked-owner account:
1. `/browse` map shows that owner's unlisted locations as green dots (others taupe), same size.
2. Legend shows "Your locations" with a green swatch; toggling it off reverts the dots to taupe/crimson and restores pin-popup behavior; toggling back re-greens.
3. Clicking a green unlisted dot navigates to `/account/locations/[id]` showing details + Net Sales/MCR/reviews (or the not-connected state).
4. An owned active listing's dot is green and still navigates to `/listings/[id]`.
5. A different signed-in user visiting the first owner's `/account/locations/[id]` URL gets a 404.
6. A non-owner account sees the map exactly as before (no green, no legend row).

- [ ] **Step 3: Push and open the PR (do NOT merge)**

```bash
git push -u origin feat/owner-map-highlight
gh pr create --base main --title "feat: highlight owner's locations on the map with owner detail pages" --body "<summary of the change, link to the spec file, verification notes>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Report the PR URL to the user. **Do not merge** — the user reviews and merges.
