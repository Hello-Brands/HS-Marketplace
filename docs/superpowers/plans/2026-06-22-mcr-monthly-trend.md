# MCR Card Monthly Trendline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the MCR (Membership Conversion) card a real 12-point monthly trendline while keeping its headline the pooled trailing-12-month MCR.

**Architecture:** Add a month-bucketed MCR query + pure shaper + cached getter in `queries.ts` (mirroring the Net Sales monthly pattern, reusing the existing `formatMonthLabel` helper and two-phase sort-then-format). Then wire `fetchLocationMembership` to keep `lastMonth` = pooled TTM MCR (unchanged headline) but attach the real monthly trend and a real MoM, with a single-point fallback when no monthly data exists. No UI or schema changes.

**Tech Stack:** Next.js (server-only), `@google-cloud/bigquery`, `unstable_cache`, Vitest 4, Zod.

## Global Constraints

- BigQuery code is `server-only`; tests mock `@/lib/bigquery/queries` and mock `server-only` with `vi.mock("server-only", () => ({}))`.
- MCR is a **ratio** — the card headline stays the **pooled TTM** value (`getMcrByLocation()`, unchanged); the monthly query feeds the **trend only**. Never derive the headline by summing/averaging monthly values.
- Window is **12 full months** — exclude the partial current month in SQL: `AND APPOINTMENT_DATE < DATE_TRUNC(CURRENT_DATE(), MONTH)`.
- Trend month labels are friendly `"Mon YYYY"` (e.g. `"Jul 2025"`) via the existing `formatMonthLabel()` helper; sort by the raw `"%Y-%m"` key BEFORE formatting (two-phase), so order is chronological.
- **Drop zero-prospect months** (null `mcr_pct`) from the trend; **keep** a legitimate `0` (prospects > 0, no new members).
- Trend `value` is the percentage number (e.g. `42.3`), matching the `membershipConversion` formatter `(v) => ${v.toFixed(1)}%`.
- `momChange` = latest full month vs prior, from the last two trend points; `0` if fewer than 2 points or prior is 0.
- `KpiMetric.source` for live data is `"bigquery"`.
- `unstable_cache` cannot store a `Map` — store `Array.from(map.entries())` and rebuild in the wrapper (mirror existing pattern).
- Test runner: `npm test` (`vitest run`). Commit after each task with the shown message.

## File Map

**Modify:**
- `src/lib/bigquery/queries.ts` — add `McrTrendRow` type, `MCR_TREND_SQL`, `rowsToMcrTrendByLocation`, `cachedMcrTrend`, `getMcrTrendByLocation`. (Existing `getMcrByLocation` / Net Sales code untouched.)
- `src/__tests__/bigquery/queries.test.ts` — add a `rowsToMcrTrendByLocation` describe block; extend the import.
- `src/lib/kpi/fetch.ts` — rewrite `fetchLocationMembership`; extend the queries import.
- `src/__tests__/kpi/membership.test.ts` — rewrite to mock both pooled + trend getters and assert the new behavior.

**No new files. No UI/schema changes.**

---

### Task 1: Monthly MCR query, shaper, and cached getter

**Files:**
- Modify: `src/lib/bigquery/queries.ts`
- Test: `src/__tests__/bigquery/queries.test.ts`

**Interfaces:**
- Consumes: `runQuery`, `toNumber`, `formatMonthLabel`, `unstable_cache` (all existing in the file).
- Produces:
  - `rowsToMcrTrendByLocation(rows: McrTrendRow[]): Map<string, { month: string; value: number }[]>` — per location, sorted-asc monthly points with friendly labels; null-`mcr_pct` months dropped. Exported for tests.
  - `getMcrTrendByLocation(): Promise<Map<string, { month: string; value: number }[]>>` — cached daily.
  - `type McrTrendRow = { LOCATION_NAME: string | null; mcr_month: string | null; mcr_pct: Numeric }`.

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/bigquery/queries.test.ts`, extend the existing import line to add `rowsToMcrTrendByLocation`:
```typescript
import { rowsToNetSalesByLocation, rowsToMcrMap, rowsToMcrTrendByLocation } from "@/lib/bigquery/queries"
```
Then append this describe block to the file:
```typescript
describe("rowsToMcrTrendByLocation", () => {
  it("sorts months chronologically with friendly labels", () => {
    const map = rowsToMcrTrendByLocation([
      { LOCATION_NAME: "SH", mcr_month: "2025-08", mcr_pct: 37.3 },
      { LOCATION_NAME: "SH", mcr_month: "2025-07", mcr_pct: 42.3 },
      { LOCATION_NAME: "SH", mcr_month: "2025-09", mcr_pct: 28.2 },
    ])
    expect(map.get("SH")).toEqual([
      { month: "Jul 2025", value: 42.3 },
      { month: "Aug 2025", value: 37.3 },
      { month: "Sep 2025", value: 28.2 },
    ])
  })

  it("drops zero-prospect months (null mcr_pct) but keeps a legitimate 0%", () => {
    const map = rowsToMcrTrendByLocation([
      { LOCATION_NAME: "SH", mcr_month: "2025-07", mcr_pct: null },
      { LOCATION_NAME: "SH", mcr_month: "2025-08", mcr_pct: 0 },
    ])
    expect(map.get("SH")).toEqual([{ month: "Aug 2025", value: 0 }])
  })

  it("skips rows with null location name or null month", () => {
    const map = rowsToMcrTrendByLocation([
      { LOCATION_NAME: null, mcr_month: "2025-07", mcr_pct: 30 },
      { LOCATION_NAME: "SH", mcr_month: null, mcr_pct: 30 },
    ])
    expect(map.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/bigquery/queries.test.ts`
Expected: FAIL — `rowsToMcrTrendByLocation` is not exported.

- [ ] **Step 3: Implement in `queries.ts`**

(a) Add the row type next to the other row types (after the `McrRow` line, ~line 10):
```typescript
type McrTrendRow = { LOCATION_NAME: string | null; mcr_month: string | null; mcr_pct: Numeric }
```

(b) Add the SQL after the `MCR_SQL` block (~line 31):
```typescript
const MCR_TREND_SQL = `
  SELECT LOCATION_NAME,
    FORMAT_DATE('%Y-%m', DATE_TRUNC(APPOINTMENT_DATE, MONTH)) AS mcr_month,
    ROUND(SAFE_DIVIDE(SUM(NON_LASER_NEW_MEMBERS), SUM(NON_LASER_PROSPECTS)) * 100, 1) AS mcr_pct
  FROM \`even-affinity-388602.data_mart_for_tools.vw_mcr_data_agg_raw\`
  WHERE APPOINTMENT_DATE >= DATE_SUB(DATE_TRUNC(CURRENT_DATE(), MONTH), INTERVAL 12 MONTH)
    AND APPOINTMENT_DATE < DATE_TRUNC(CURRENT_DATE(), MONTH)
  GROUP BY LOCATION_NAME, mcr_month
  ORDER BY LOCATION_NAME, mcr_month`
```

(c) Add the shaper after `rowsToMcrMap` (~line 85):
```typescript
/**
 * Pure: monthly MCR rows → per-location sorted { month label, pct } trend.
 * Drops zero-prospect (null mcr_pct) months; keeps a legitimate 0. Exported for tests.
 */
export function rowsToMcrTrendByLocation(
  rows: McrTrendRow[]
): Map<string, { month: string; value: number }[]> {
  // Accumulate with raw "YYYY-MM" key for correct chronological sorting
  const raw = new Map<string, { rawMonth: string; value: number }[]>()
  for (const r of rows) {
    if (!r.LOCATION_NAME || !r.mcr_month || r.mcr_pct === null || r.mcr_pct === undefined) continue
    const arr = raw.get(r.LOCATION_NAME) ?? []
    arr.push({ rawMonth: r.mcr_month, value: toNumber(r.mcr_pct) })
    raw.set(r.LOCATION_NAME, arr)
  }
  const map = new Map<string, { month: string; value: number }[]>()
  for (const [name, arr] of raw.entries()) {
    arr.sort((a, b) => a.rawMonth.localeCompare(b.rawMonth))
    map.set(name, arr.map(({ rawMonth, value }) => ({ month: formatMonthLabel(rawMonth), value })))
  }
  return map
}
```

(d) Add the cached getter after `cachedMcr` / `getMcrByLocation` (~line 111):
```typescript
const cachedMcrTrend = unstable_cache(
  async () => {
    const rows = await runQuery<McrTrendRow>(MCR_TREND_SQL)
    return Array.from(rowsToMcrTrendByLocation(rows ?? []).entries())
  },
  ["bq-mcr-trend-ttm"],
  { revalidate: 86400, tags: ["bq-mcr-trend"] }
)

export async function getMcrTrendByLocation(): Promise<Map<string, { month: string; value: number }[]>> {
  return new Map(await cachedMcrTrend())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/bigquery/queries.test.ts`
Expected: PASS (the existing tests plus the 3 new `rowsToMcrTrendByLocation` cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors (this task only adds new exports; nothing consumes them yet).

- [ ] **Step 6: Commit**

```bash
git add src/lib/bigquery/queries.ts src/__tests__/bigquery/queries.test.ts
git commit -m "feat(rock-2): month-bucketed MCR query + per-location trend shaper"
```

---

### Task 2: Wire the monthly trend into the MCR metric

**Files:**
- Modify: `src/lib/kpi/fetch.ts`
- Test: `src/__tests__/kpi/membership.test.ts`

**Interfaces:**
- Consumes: `getMcrByLocation` (pooled, existing), `getMcrTrendByLocation` (Task 1), `canFetchLiveData` (existing).
- Produces: `fetchLocationMembership(args)` unchanged signature; returns a `KpiMetric` whose `lastMonth` is the pooled TTM MCR, `trend` is the monthly series (or a single `"TTM"` fallback point), and `momChange` is latest-vs-prior.

- [ ] **Step 1: Rewrite the membership test**

Replace the entire contents of `src/__tests__/kpi/membership.test.ts` with:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getMcrByLocation = vi.fn()
const getMcrTrendByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({
  getMcrByLocation,
  getMcrTrendByLocation,
  getNetSalesByLocation: vi.fn(),
}))

describe("fetchLocationMembership", () => {
  beforeEach(() => {
    vi.resetModules()
    getMcrByLocation.mockReset()
    getMcrTrendByLocation.mockReset()
  })

  it("returns null when not active+confirmed", async () => {
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "draft", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r).toBeNull()
  })

  it("returns null when location name missing", async () => {
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: null })
    expect(r).toBeNull()
  })

  it("uses pooled TTM as the headline + monthly trend + real MoM when connected", async () => {
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))
    getMcrTrendByLocation.mockResolvedValue(new Map([["Sugar House", [
      { month: "Apr 2026", value: 32.6 },
      { month: "May 2026", value: 40.4 },
    ]]]))
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.lastMonth).toBe(34.5) // pooled TTM, NOT the latest month
    expect(r?.source).toBe("bigquery")
    expect(r?.trend).toEqual([
      { month: "Apr 2026", value: 32.6 },
      { month: "May 2026", value: 40.4 },
    ])
    expect(r?.momChange).toBeCloseTo((40.4 - 32.6) / 32.6)
  })

  it("falls back to a single TTM point when no monthly trend exists", async () => {
    getMcrByLocation.mockResolvedValue(new Map([["Sugar House", 34.5]]))
    getMcrTrendByLocation.mockResolvedValue(new Map())
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.lastMonth).toBe(34.5)
    expect(r?.trend).toEqual([{ month: "TTM", value: 34.5 }])
    expect(r?.momChange).toBe(0)
  })

  it("returns null when location absent from the pooled BigQuery map", async () => {
    getMcrByLocation.mockResolvedValue(new Map())
    getMcrTrendByLocation.mockResolvedValue(new Map())
    const { fetchLocationMembership } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationMembership({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Nowhere" })
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/membership.test.ts`
Expected: FAIL — `getMcrTrendByLocation` is not yet imported/used by `fetch.ts`; the connected test gets the old single-`"TTM"` trend and `momChange 0`.

- [ ] **Step 3: Update `fetch.ts`**

(a) Extend the queries import (line ~5) from:
```typescript
import { getNetSalesByLocation, getMcrByLocation } from "@/lib/bigquery/queries"
```
to:
```typescript
import { getNetSalesByLocation, getMcrByLocation, getMcrTrendByLocation } from "@/lib/bigquery/queries"
```

(b) Replace the entire `fetchLocationMembership` function with:
```typescript
export async function fetchLocationMembership(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<KpiMetric | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null
  }
  const [pooledMap, trendMap] = await Promise.all([getMcrByLocation(), getMcrTrendByLocation()])
  const pct = pooledMap.get(args.bqLocationName)
  if (pct === undefined) return null // headline drives connectivity

  // Headline stays the pooled TTM ratio; the monthly series feeds the trend only.
  const points = trendMap.get(args.bqLocationName) ?? []
  const trend = points.length > 0 ? points : [{ month: "TTM", value: pct }]
  const last = points.length > 0 ? points[points.length - 1].value : 0
  const prior = points.length > 1 ? points[points.length - 2].value : 0
  const momChange = points.length > 1 && prior !== 0 ? (last - prior) / prior : 0

  return {
    lastMonth: pct,
    momChange,
    trend,
    updatedAt: new Date().toISOString(),
    source: "bigquery",
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/kpi/membership.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npm test`
Expected: all tests pass.

Run: `npx tsc --noEmit`
Expected: zero errors.

Run: `npm run build`
Expected: build succeeds (pre-existing `ENOTFOUND api.hellosugar.salon` during static gen is expected/non-blocking).

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpi/fetch.ts src/__tests__/kpi/membership.test.ts
git commit -m "feat(rock-2): MCR card shows monthly trend (pooled TTM headline + real MoM)"
```

---

## Self-Review

**Spec coverage:**
- Month-bucketed MCR query (verified SQL) → Task 1 (b). ✓
- Per-location trend shaper, friendly labels, two-phase sort → Task 1 (c). ✓
- Drop zero-prospect (null) months, keep legit 0 → Task 1 (c) + test. ✓
- Cached getter, key `bq-mcr-trend-ttm`, Map serialization → Task 1 (d). ✓
- Headline stays pooled TTM (`getMcrByLocation`), trend independent → Task 2 (b). ✓
- Real `momChange` (latest vs prior, guards) → Task 2 (b) + test. ✓
- Single-point fallback when no monthly data → Task 2 (b) + test. ✓
- Connectivity gated on the pooled map; safety gate unchanged → Task 2 (b). ✓
- No UI/schema changes → File Map. ✓
- Tests mock BigQuery, never live → Tasks 1, 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows literal code or an exact edit with literal strings. ✓

**Type consistency:** `McrTrendRow` defined Task 1 (a), consumed by `rowsToMcrTrendByLocation`/`MCR_TREND_SQL` runQuery in Task 1. `getMcrTrendByLocation(): Map<string, {month,value}[]>` defined Task 1 (d), imported and consumed in Task 2 (a)/(b). Trend point shape `{month:string; value:number}` matches `KpiMonth` (schema) and the membership metric's `trend`. `formatMonthLabel` reused (defined in queries.ts). `lastMonth` = pooled `pct` (number) consistent with the `membershipConversion` percentage formatter. ✓

**Scope:** Single cohesive change (one query + one fetch fn), 2 tasks. ✓
