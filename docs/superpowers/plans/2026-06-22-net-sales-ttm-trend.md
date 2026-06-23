# Net Sales (TTM) with Monthly Trendline + TTM MCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the YTD single-value BigQuery KPI queries with trailing-12-full-month queries, so the Net Sales card shows a past-year total and the click-through trend modal shows a real month-by-month series; MCR moves to the same TTM window.

**Architecture:** Keep the existing fetch → gate → cache → UI pipeline and change only the data shape. The Net Sales query becomes monthly; a new shaper produces `{ totalCents, trend[] }` per location. The fetch layer puts **dollars** into the `KpiMetric` (fixing a latent 100× cents bug) and returns `totalCents` separately for the financials card. The existing `KpiTrendModal`/`KpiTrendChart` render the 12-point trend with no new components. Partial current month is excluded in SQL on both queries.

**Tech Stack:** Next.js (App Router, server components), `@google-cloud/bigquery`, `unstable_cache`, Vitest 4, Zod, Tailwind.

## Global Constraints

- All BigQuery code is `server-only` — credentials must never reach the client bundle.
- Money: BigQuery returns **dollars**. The financials-card **total** is stored in **cents** (`Math.round(dollars * 100)`). The `KpiMetric` (`lastMonth`, `trend[].value`) for revenue is in **DOLLARS** — the `KpiCard`/`KpiTrendChart` format raw values as dollars (mock revenue uses dollars, e.g. `45230` → "$45,230").
- MCR is a **percentage number** (e.g. `38.0`), already `* 100` in SQL.
- Window is **12 full months** — exclude the partial current month in SQL with `AND <date_col> < DATE_TRUNC(CURRENT_DATE(), MONTH)`. Apply to BOTH queries.
- Revenue card label is exactly **"Net Sales (Trailing 12 Months, Cash + Credit)"**.
- Safety invariant unchanged: live data only when `listingStatus === "active" && dataMappingStatus === "confirmed"` (`canFetchLiveData`).
- `KpiMetric.source` for live data is the string `"bigquery"`.
- Tests must NOT hit live BigQuery — mock `@/lib/bigquery/queries` (or `@google-cloud/bigquery`). Mock `server-only` with `vi.mock("server-only", () => ({}))` in any test importing a `server-only` module.
- Test runner: `npm test` (`vitest run`). Tests live in `src/__tests__/**/*.test.ts`.
- `unstable_cache` serializes return values and cannot store a `Map` — store `Array.from(map.entries())` and rebuild the `Map` in the exported wrapper (mirror the existing pattern in `queries.ts`).
- This is NOT the Next.js you know — if `unstable_cache` typechecks oddly, check `node_modules/next/dist/docs/` before changing the caching pattern.
- Commit after each task with the shown message.

## File Map

**Modify:**
- `src/lib/bigquery/queries.ts` — both SQL strings (monthly Net Sales + 12-full-month bound on both); new `rowsToNetSalesByLocation`; `getNetSalesByLocation` return type; cache keys/tags `ytd`→`ttm`.
- `src/__tests__/bigquery/queries.test.ts` — replace net-sales map tests with `rowsToNetSalesByLocation` tests; keep MCR tests.
- `src/lib/kpi/fetch.ts` — `fetchLocationRevenue` returns `{ metric, totalCents }` with dollars metric + real `momChange`; `fetchLocationMembership` trend label `"YTD"`→`"TTM"`.
- `src/__tests__/kpi/revenue.test.ts` — new `LocationNetSales` mock shape + assertions.
- `src/__tests__/kpi/membership.test.ts` — assert TTM trend label.
- `src/components/listing-detail/FinancialsGrid.tsx` — prop `netSalesYtd`→`netSalesTtm`, label text.
- `src/app/listings/[id]/page.tsx` — `netSalesYtd`→`netSalesTtm`, `ytdCents`→`totalCents`.
- `src/components/kpi/KpiSection.tsx` — section copy "(year-to-date)"→"(trailing 12 months)".
- `C:\Users\Owner\.claude\projects\C--Users-Owner-Documents-HelloSugar-HS-Marketplace\memory\mr-percent-definition.md` — window YTD→TTM.

**No new files. No deletions.**

---

### Task 1: Net Sales monthly query + `rowsToNetSalesByLocation` shaper

**Files:**
- Modify: `src/lib/bigquery/queries.ts`
- Test: `src/__tests__/bigquery/queries.test.ts`

**Interfaces:**
- Consumes: `runQuery`, `toNumber` (existing in `queries.ts`).
- Produces:
  - `type LocationNetSales = { totalCents: number; trend: { month: string; value: number }[] }`
  - `rowsToNetSalesByLocation(rows: NetSalesRow[]): Map<string, LocationNetSales>` — `totalCents` = Σ months in cents; `trend[].value` in **dollars**, sorted by `month` asc. Exported for tests.
  - `getNetSalesByLocation(): Promise<Map<string, LocationNetSales>>` (return type CHANGED from `Map<string, number>`).

- [ ] **Step 1: Replace the net-sales tests with the new shaper's tests**

In `src/__tests__/bigquery/queries.test.ts`, replace the entire `describe("rowsToNetSalesMap", …)` block (and the `rowsToNetSalesMap` name in the import on line 5) so the file reads:

```typescript
import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { rowsToNetSalesByLocation, rowsToMcrMap } from "@/lib/bigquery/queries"

describe("rowsToNetSalesByLocation", () => {
  it("sums monthly dollars into cents and keeps a sorted dollar trend", () => {
    const map = rowsToNetSalesByLocation([
      { LOCATION_NAME: "Sugar House", sales_month: "2025-08", cash_plus_credit: 100.50 },
      { LOCATION_NAME: "Sugar House", sales_month: "2025-07", cash_plus_credit: 200 },
      { LOCATION_NAME: "Sugar House", sales_month: "2025-09", cash_plus_credit: 50 },
    ])
    const sh = map.get("Sugar House")!
    expect(sh.totalCents).toBe(35050) // (200 + 100.50 + 50) * 100
    expect(sh.trend).toEqual([
      { month: "2025-07", value: 200 },
      { month: "2025-08", value: 100.5 },
      { month: "2025-09", value: 50 },
    ])
  })

  it("skips rows with null/blank location name", () => {
    const map = rowsToNetSalesByLocation([
      { LOCATION_NAME: null, sales_month: "2025-07", cash_plus_credit: 100 },
    ])
    expect(map.size).toBe(0)
  })

  it("coerces string / Big-like numeric values (NUMERIC columns)", () => {
    const map = rowsToNetSalesByLocation([
      { LOCATION_NAME: "Str", sales_month: "2025-07", cash_plus_credit: "168000.55" },
      { LOCATION_NAME: "Big", sales_month: "2025-08", cash_plus_credit: { toString: () => "4200.00" } },
    ])
    expect(map.get("Str")!.totalCents).toBe(16800055)
    expect(map.get("Big")!.totalCents).toBe(420000)
  })
})

describe("rowsToMcrMap", () => {
  it("maps mcr_pct as a number keyed by LOCATION_NAME", () => {
    const map = rowsToMcrMap([{ LOCATION_NAME: "Sugar House", mcr_pct: 38 }])
    expect(map.get("Sugar House")).toBe(38)
  })

  it("treats null mcr_pct as 0", () => {
    const map = rowsToMcrMap([{ LOCATION_NAME: "X", mcr_pct: null }])
    expect(map.get("X")).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/bigquery/queries.test.ts`
Expected: FAIL — `rowsToNetSalesByLocation` is not exported.

- [ ] **Step 3: Update `queries.ts` — Net Sales SQL, types, and shaper**

In `src/lib/bigquery/queries.ts`:

(a) Replace the `NetSalesRow` type (line ~8) with:
```typescript
type NetSalesRow = { LOCATION_NAME: string | null; sales_month: string | null; cash_plus_credit: Numeric }
```

(b) Add the exported type near the other types:
```typescript
export type LocationNetSales = { totalCents: number; trend: { month: string; value: number }[] }
```

(c) Replace `NET_SALES_SQL` with Prince's monthly query bounded to 12 full months:
```typescript
const NET_SALES_SQL = `
  SELECT
    LOCATION_NAME,
    FORMAT_DATE('%Y-%m', DATE_TRUNC(CREATED_ON, MONTH)) AS sales_month,
    ROUND(SUM(TRANSACTION_AMOUNT), 2) AS cash_plus_credit
  FROM \`even-affinity-388602.snowflake_data.vw_order_payments_raw\`
  WHERE CREATED_ON >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
    AND CREATED_ON < DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY LOCATION_NAME, sales_month
  ORDER BY LOCATION_NAME, sales_month`
```

(d) Replace the `rowsToNetSalesMap` function with:
```typescript
/** Pure: monthly rows → per-location { totalCents, trend (dollars, sorted asc) }. Exported for tests. */
export function rowsToNetSalesByLocation(rows: NetSalesRow[]): Map<string, LocationNetSales> {
  const map = new Map<string, LocationNetSales>()
  for (const r of rows) {
    if (!r.LOCATION_NAME || !r.sales_month) continue
    const dollars = toNumber(r.cash_plus_credit)
    const entry = map.get(r.LOCATION_NAME) ?? { totalCents: 0, trend: [] }
    entry.totalCents += Math.round(dollars * 100)
    entry.trend.push({ month: r.sales_month, value: dollars })
    map.set(r.LOCATION_NAME, entry)
  }
  for (const entry of map.values()) {
    entry.trend.sort((a, b) => a.month.localeCompare(b.month))
  }
  return map
}
```

(e) Replace the `cachedNetSales` block and `getNetSalesByLocation`:
```typescript
const cachedNetSales = unstable_cache(
  async () => {
    const rows = await runQuery<NetSalesRow>(NET_SALES_SQL)
    return Array.from(rowsToNetSalesByLocation(rows ?? []).entries())
  },
  ["bq-net-sales-ttm"],
  { revalidate: 86400, tags: ["bq-net-sales"] }
)

export async function getNetSalesByLocation(): Promise<Map<string, LocationNetSales>> {
  return new Map(await cachedNetSales())
}
```

> Note: `totalCents` rounds per month then sums (each month is already rounded to cents), avoiding float drift in the total.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/bigquery/queries.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/lib/kpi/fetch.ts` and `src/app/listings/[id]/page.tsx` (they still read the old `Map<string, number>` / `ytdCents` shape — fixed in Tasks 2–3). No errors inside `queries.ts` itself.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bigquery/queries.ts src/__tests__/bigquery/queries.test.ts
git commit -m "feat(rock-2): Net Sales monthly TTM query + per-location total/trend shaper"
```

---

### Task 2: MCR query — same 12-full-month window

**Files:**
- Modify: `src/lib/bigquery/queries.ts`

**Interfaces:**
- Produces: `getMcrByLocation()` unchanged signature (`Promise<Map<string, number>>`); cache key renamed to `bq-mcr-ttm`.

- [ ] **Step 1: Update `MCR_SQL` to the TTM window with the full-month bound**

In `src/lib/bigquery/queries.ts`, replace `MCR_SQL`:
```typescript
const MCR_SQL = `
  SELECT LOCATION_NAME,
    ROUND(SAFE_DIVIDE(SUM(NON_LASER_NEW_MEMBERS), SUM(NON_LASER_PROSPECTS)) * 100, 1) AS mcr_pct
  FROM \`even-affinity-388602.data_mart_for_tools.vw_mcr_data_agg_raw\`
  WHERE APPOINTMENT_DATE >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
    AND APPOINTMENT_DATE < DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY LOCATION_NAME
  ORDER BY mcr_pct DESC`
```

- [ ] **Step 2: Rename the MCR cache key `ytd`→`ttm`**

In the `cachedMcr` `unstable_cache` call, change the key array `["bq-mcr-ytd"]` to `["bq-mcr-ttm"]`. Leave the `tags: ["bq-mcr"]` and `revalidate` unchanged.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: same as Task 1 Step 5 (errors only in `fetch.ts` / `page.tsx`); none new in `queries.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/bigquery/queries.ts
git commit -m "feat(rock-2): MCR query moves to 12-full-month TTM window"
```

---

### Task 3: Fetch layer — dollars metric, totalCents, real MoM

**Files:**
- Modify: `src/lib/kpi/fetch.ts`
- Test: `src/__tests__/kpi/revenue.test.ts`, `src/__tests__/kpi/membership.test.ts`

**Interfaces:**
- Consumes: `getNetSalesByLocation(): Map<string, LocationNetSales>`, `getMcrByLocation(): Map<string, number>` (Tasks 1–2); `canFetchLiveData` (existing).
- Produces:
  - `fetchLocationRevenue(args): Promise<{ metric: KpiMetric; totalCents: number } | null>` — `totalCents` in cents; `metric.lastMonth` = total in **dollars**; `metric.trend` = 12 dollar points; `metric.momChange` = latest-vs-prior full month; `metric.source = "bigquery"`.
  - `fetchLocationMembership(args): Promise<KpiMetric | null>` — unchanged shape; trend point label `"TTM"`.

- [ ] **Step 1: Rewrite the revenue test for the new shape**

Replace `src/__tests__/kpi/revenue.test.ts` with:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getNetSalesByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({ getNetSalesByLocation, getMcrByLocation: vi.fn() }))

describe("fetchLocationRevenue", () => {
  beforeEach(() => { vi.resetModules(); getNetSalesByLocation.mockReset() })

  it("returns null when not active+confirmed", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "draft", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r).toBeNull()
  })

  it("returns null when location name missing", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: null })
    expect(r).toBeNull()
  })

  it("returns total cents + dollars metric with real trend and MoM when connected", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map([["Sugar House", {
      totalCents: 35000,
      trend: [
        { month: "2025-07", value: 100 },
        { month: "2025-08", value: 100 },
        { month: "2025-09", value: 150 },
      ],
    }]]))
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.totalCents).toBe(35000)
    expect(r?.metric.source).toBe("bigquery")
    expect(r?.metric.lastMonth).toBe(350)         // 35000 cents -> 350 dollars
    expect(r?.metric.trend).toHaveLength(3)
    expect(r?.metric.momChange).toBeCloseTo(0.5)  // (150 - 100) / 100
  })

  it("returns null when location absent from the BigQuery map", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map())
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Nowhere" })
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 2: Add a TTM-label assertion to the membership test**

In `src/__tests__/kpi/membership.test.ts`, in the "returns bigquery-sourced MCR metric when connected" test, add after the existing `source` assertion (line ~27):
```typescript
    expect(r?.trend).toEqual([{ month: "TTM", value: 38 }])
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run src/__tests__/kpi/revenue.test.ts src/__tests__/kpi/membership.test.ts`
Expected: FAIL — revenue reads `totalCents`/dollar `lastMonth`/`momChange` not yet produced; membership trend label still `"YTD"`.

- [ ] **Step 4: Rewrite `fetchLocationRevenue` and relabel the membership trend**

In `src/lib/kpi/fetch.ts`, replace `fetchLocationMembership` and `fetchLocationRevenue` (the two functions at the bottom of the file) with:
```typescript
export async function fetchLocationMembership(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<KpiMetric | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null
  }
  const map = await getMcrByLocation()
  const pct = map.get(args.bqLocationName)
  if (pct === undefined) return null
  return {
    lastMonth: pct,
    momChange: 0,
    trend: [{ month: "TTM", value: pct }],
    updatedAt: new Date().toISOString(),
    source: "bigquery",
  }
}

export async function fetchLocationRevenue(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<{ metric: KpiMetric; totalCents: number } | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null // "not connected"
  }
  const map = await getNetSalesByLocation()
  const ns = map.get(args.bqLocationName)
  if (ns === undefined) return null

  // KpiCard/KpiTrendChart format values as dollars; the financials card uses cents.
  const trend = ns.trend
  const last = trend.length > 0 ? trend[trend.length - 1].value : 0
  const prior = trend.length > 1 ? trend[trend.length - 2].value : 0
  const momChange = prior !== 0 ? (last - prior) / prior : 0

  return {
    totalCents: ns.totalCents,
    metric: {
      lastMonth: ns.totalCents / 100, // TTM total in dollars
      momChange,
      trend,
      updatedAt: new Date().toISOString(),
      source: "bigquery",
    },
  }
}
```

Confirm the import on line 5 already reads `import { getNetSalesByLocation, getMcrByLocation } from "@/lib/bigquery/queries"` (it does — no change needed).

- [ ] **Step 5: Run both tests to verify they pass**

Run: `npx vitest run src/__tests__/kpi/revenue.test.ts src/__tests__/kpi/membership.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/app/listings/[id]/page.tsx` (still reads `r.ytdCents` / passes `netSalesYtd`) — fixed in Task 4. None in `fetch.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/kpi/fetch.ts src/__tests__/kpi/revenue.test.ts src/__tests__/kpi/membership.test.ts
git commit -m "feat(rock-2): revenue metric in dollars + TTM total/MoM; MCR trend labeled TTM"
```

---

### Task 4: Financials card label + page wiring

**Files:**
- Modify: `src/components/listing-detail/FinancialsGrid.tsx`
- Modify: `src/app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `fetchLocationRevenue` returning `{ metric, totalCents }` (Task 3).
- Produces: `FinancialsGrid` prop renamed `netSalesYtd` → `netSalesTtm` (type unchanged: `{ cents: number; asOf: string } | null`).

- [ ] **Step 1: Rename the prop and relabel both cards in `FinancialsGrid.tsx`**

In `src/components/listing-detail/FinancialsGrid.tsx`:

(a) In `FinancialsGridProps` (line ~5), rename `netSalesYtd?: { cents: number; asOf: string } | null` → `netSalesTtm?: { cents: number; asOf: string } | null`.

(b) In the function signature (line ~58), rename the destructured `netSalesYtd` → `netSalesTtm`.

(c) Replace the three uses inside the JSX (lines ~72–92):
- `{netSalesYtd != null ? (` → `{netSalesTtm != null ? (`
- the connected-card label `Net Sales (YTD, Cash + Credit)` → `Net Sales (Trailing 12 Months, Cash + Credit)`
- `formatPrice(netSalesYtd.cents)` → `formatPrice(netSalesTtm.cents)`
- `netSalesYtd.asOf` → `netSalesTtm.asOf`
- the fallback `MetricCard` `label="Net Sales (YTD, Cash + Credit)"` → `label="Net Sales (Trailing 12 Months, Cash + Credit)"`

- [ ] **Step 2: Update `page.tsx` — variable name, totalCents, prop**

In `src/app/listings/[id]/page.tsx`:

(a) Replace the net-sales computation block (lines ~54–68) with:
```typescript
  // Compute BigQuery trailing-12-month net sales from confirmed salon locations
  const salonLocations = listing.locations.filter(l => l.locationType === 'salon')
  const revenueResults = await Promise.all(
    salonLocations.map(l =>
      fetchLocationRevenue({
        listingStatus: listing.status,
        mappingStatus: l.dataMappingStatus,
        bqLocationName: l.bqLocationName,
      })
    )
  )
  const connected = revenueResults.filter((r): r is NonNullable<typeof r> => r !== null)
  const netSalesTtm = connected.length > 0
    ? { cents: connected.reduce((sum, r) => sum + r.totalCents, 0), asOf: connected[0].metric.updatedAt }
    : null
```

(b) Update the `FinancialsGrid` usage (line ~162):
```typescript
            <FinancialsGrid listing={listing} netSalesTtm={netSalesTtm} hasSalonLocations={salonLocations.length > 0} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/listing-detail/FinancialsGrid.tsx "src/app/listings/[id]/page.tsx"
git commit -m "feat(rock-2): Net Sales card label -> Trailing 12 Months; wire totalCents"
```

---

### Task 5: KpiSection copy + full verification

**Files:**
- Modify: `src/components/kpi/KpiSection.tsx`

**Interfaces:**
- Consumes: nothing new — copy-only change plus a full-suite gate.

- [ ] **Step 1: Update the Performance Data subtitle copy**

In `src/components/kpi/KpiSection.tsx` (line ~82), change:
```typescript
            ? "Net Sales and MCR are live from BigQuery (year-to-date)."
```
to:
```typescript
            ? "Net Sales and MCR are live from BigQuery (trailing 12 months)."
```

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all tests pass (no `rowsToNetSalesMap`, no `ytdCents`, no `"YTD"` trend references remain).

- [ ] **Step 3: Confirm no stale identifiers remain**

Run: `grep -rn "ytdCents\|netSalesYtd\|rowsToNetSalesMap\|year-to-date" src/`
Expected: no matches.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds (catches server/client boundary issues with `@google-cloud/bigquery`).

- [ ] **Step 5: Commit**

```bash
git add src/components/kpi/KpiSection.tsx
git commit -m "feat(rock-2): Performance Data copy -> trailing 12 months"
```

---

### Task 6: Update the MCR memory note (window YTD → TTM)

**Files:**
- Modify: `C:\Users\Owner\.claude\projects\C--Users-Owner-Documents-HelloSugar-HS-Marketplace\memory\mr-percent-definition.md`

**Interfaces:**
- Consumes: nothing — documentation only.

- [ ] **Step 1: Read the current note**

Read `C:\Users\Owner\.claude\projects\C--Users-Owner-Documents-HelloSugar-HS-Marketplace\memory\mr-percent-definition.md` to see its current wording.

- [ ] **Step 2: Update the window**

Change the metric window from **YTD** to **trailing 12 full months (partial current month excluded)** for BOTH Net Sales and MCR. Keep the MCR definition itself (NON_LASER_NEW_MEMBERS ÷ NON_LASER_PROSPECTS, laser excluded, from `data_mart_for_tools.vw_mcr_data_agg_raw`) unchanged. Add a one-line note: "Net Sales trend is monthly (12 points); MCR has no monthly breakdown yet — single TTM value (follow-up: ask Prince for a month-bucketed MCR query)."

- [ ] **Step 3: No commit needed**

Memory files live outside the repo; nothing to commit. (If `MEMORY.md`'s index line for this note still reads accurately, leave it; otherwise update the one-line hook.)

---

## Self-Review

**Spec coverage:**
- Exclude partial current month (SQL bound, both queries) → Task 1 (c), Task 2 Step 1. ✓
- Net Sales monthly query + total/trend shaper → Task 1. ✓
- `getNetSalesByLocation` return-type change → Task 1 (e). ✓
- MCR TTM window → Task 2. ✓
- Cents→dollars bug fix (metric in dollars, totalCents separate) → Task 3 Step 4. ✓
- Real MoM (latest vs prior month) → Task 3 Step 4. ✓
- MCR trend label `"TTM"` → Task 3 Step 4 + test Step 2. ✓
- Card label "Net Sales (Trailing 12 Months, Cash + Credit)" → Task 4 Step 1. ✓
- page.tsx `totalCents` / `netSalesTtm` → Task 4 Step 2. ✓
- KpiSection "(trailing 12 months)" copy → Task 5 Step 1. ✓
- Cache keys `ytd`→`ttm` → Task 1 (e), Task 2 Step 2. ✓
- Memory note update + MCR follow-up → Task 6. ✓
- No new components (existing trend modal) → confirmed in File Map. ✓
- Tests mock BigQuery, never live → Tasks 1, 3 mocks. ✓

**Placeholder scan:** No TBD/TODO; every code step shows literal code or an exact rename with the literal strings. ✓

**Type consistency:** `LocationNetSales { totalCents, trend }` defined Task 1, consumed Task 3 (mock + impl) and aggregated in Task 4 (`r.totalCents`). `fetchLocationRevenue` returns `{ metric, totalCents }` in Task 3 and is read as `r.totalCents` in Task 4. `netSalesTtm` prop defined Task 4 Step 1, passed Task 4 Step 2. `metric.lastMonth` in dollars (Task 3) matches `KpiCard`'s dollar formatter. `trend[].value` in dollars (Task 1) matches `KpiTrendChart`. `"TTM"` label in impl (Task 3 Step 4) matches its test (Task 3 Step 2). ✓

**Scope:** Single cohesive data-source reshape; one plan. ✓
