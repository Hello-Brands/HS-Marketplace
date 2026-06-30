# Territory & Bundle Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop TTM Profit from territory listings (form + detail), and rebuild the bundle performance section on real BigQuery data with an aggregate view plus per-location drill-in modals.

**Architecture:** Territory changes are presentational conditionals in two existing components. Bundle changes add one pure aggregation module (`src/lib/kpi/bundle.ts`) and one server fetcher (`fetchBundleLocationKpis` in `src/lib/kpi/fetch.ts`) that reuse the same gated BigQuery maps single-location listings already use; `KpiSection` wires them, the rewritten `BundleKpiSection` renders a sortable table + per-location modal, and the legacy mock-API bundle path is deleted.

**Tech Stack:** Next.js (App Router, this repo's vendored version — read `node_modules/next/dist/docs/` before changing Next APIs), React Server + Client Components, TypeScript, Vitest (node environment), Tailwind.

## Global Constraints

- **Test runner:** `npx vitest run` — config is `vitest.config.mts`; it includes **only** `src/__tests__/**/*.test.ts` (node environment, no jsdom). Component/`.tsx` render tests are NOT part of the suite — presentational changes are gated by `npx tsc --noEmit` + manual verification, and only data/logic gets unit tests.
- **Money units:** Net Sales `KpiMetric.lastMonth` is **dollars** (TTM total); BigQuery MCR (`mcr_pct`) is already in **percent units** (e.g. `32.0`, not `0.32`). Do not re-scale.
- **Live-data gate:** real metrics only when `canFetchLiveData(listingStatus, mappingStatus)` is true (`listingStatus === "active" && mappingStatus === "confirmed"`) AND a `bqLocationName` is present.
- **Windows build lock:** do not run `next build` / `npm run dev`; use `npx tsc --noEmit` for typecheck gates and `npx vitest run` for tests.
- **Commits:** end each commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Territory financials — buyer-facing detail (`FinancialsGrid`)

**Files:**
- Modify: `src/components/listing-detail/FinancialsGrid.tsx:62-78`

**Interfaces:**
- Consumes: `ListingDetail` (already imported) — uses `listing.type`, `listing.askingPrice`, `listing.ttmProfit`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Make the top metric row conditional on listing type**

In `FinancialsGrid`, replace the fixed two-card grid (lines 65-78) with logic that renders the TTM Profit card only for non-territory listings. The Asking Price card spans full width when alone.

```tsx
export function FinancialsGrid({ listing }: FinancialsGridProps) {
  const isTerritory = listing.type === 'territory'
  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 gap-4 ${isTerritory ? '' : 'sm:grid-cols-2'}`}>
        <MetricCard
          label="Asking Price"
          value={formatPrice(listing.askingPrice)}
          variant="primary"
          ownerProvided
        />
        {!isTerritory && (
          <MetricCard
            label="TTM Profit"
            value={formatPrice(listing.ttmProfit)}
            subLabel="Trailing 12 months"
            ownerProvided
          />
        )}
      </div>
      {/* Divider + Included Assets block below stay exactly as-is */}
```

Leave the divider and "Included Assets" block (lines 80-127) unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Manual verification note**

Confirm by reasoning through the JSX: for `type === 'territory'` only the Asking Price card renders (full width, caramel `variant="primary"`); for `suite`/`flagship`/`bundle` both cards render in a 2-up grid as before. (No automated render test — see Global Constraints.)

- [ ] **Step 4: Commit**

```bash
git add src/components/listing-detail/FinancialsGrid.tsx
git commit -m "feat(listing-detail): hide TTM Profit for territory listings"
```

---

### Task 2: Territory financials — seller form (`FinancialsStep`)

**Files:**
- Modify: `src/components/listings/steps/FinancialsStep.tsx:14-74`

**Interfaces:**
- Consumes: `ListingFormData` via `useFormContext` — adds a `watch('type')` read.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Read the listing type and gate the revenue/profit UI**

At the top of the component (after the existing `watch('locations')`), add:

```tsx
const listingType = watch('type')
const isTerritory = listingType === 'territory'
```

Wrap the "Verified data (pulled from Hello Sugar)" block (currently lines 23-38) so it only renders when `!isTerritory`:

```tsx
{!isTerritory && (
  <div className="bg-gray-50 rounded-lg p-4 space-y-3">
    {/* ...existing verified-data block unchanged... */}
  </div>
)}
```

Wrap the TTM Profit field (currently lines 60-74) so it only renders when `!isTerritory`:

```tsx
{!isTerritory && (
  <div>
    <label htmlFor="ttmProfit" ...>TTM Profit (optional)</label>
    {/* ...existing input unchanged... */}
  </div>
)}
```

Leave Asking Price, square footage, reason-for-selling, and the nav buttons unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual verification note**

For a territory listing the form shows Asking Price + reason-for-selling (no verified-revenue block, no TTM Profit, and — since territories have no salon locations — the existing `salonLocations.length > 0` guard already hides square footage). For salon-bearing types the form is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/listings/steps/FinancialsStep.tsx
git commit -m "feat(listings): drop TTM Profit input for territory listings"
```

---

### Task 3: Bundle aggregation pure module (`src/lib/kpi/bundle.ts`)

**Files:**
- Create: `src/lib/kpi/bundle.ts`
- Test: `src/__tests__/kpi/bundle.test.ts`

**Interfaces:**
- Consumes: `KpiMetric` from `@/lib/kpi/schema` (type-only).
- Produces:
  - `interface BundleLocationKpi { id: string; name: string; netSales: KpiMetric | null; membership: KpiMetric | null }`
  - `interface BundleAggregate { netSales: KpiMetric | null; membership: KpiMetric | null }`
  - `function aggregateBundleLocationKpis(locations: BundleLocationKpi[]): BundleAggregate`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/kpi/bundle.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { aggregateBundleLocationKpis, type BundleLocationKpi } from "@/lib/kpi/bundle"
import type { KpiMetric } from "@/lib/kpi/schema"

function metric(lastMonth: number, trend: [string, number][]): KpiMetric {
  return {
    lastMonth,
    momChange: 0,
    trend: trend.map(([month, value]) => ({ month, value })),
    updatedAt: "2026-06-01T00:00:00Z",
    source: "bigquery",
  }
}

describe("aggregateBundleLocationKpis", () => {
  it("sums Net Sales and averages MCR across locations", () => {
    const locs: BundleLocationKpi[] = [
      { id: "a", name: "A", netSales: metric(1000, [["Jan", 400], ["Feb", 600]]), membership: metric(30, [["Jan", 28], ["Feb", 32]]) },
      { id: "b", name: "B", netSales: metric(500, [["Jan", 200], ["Feb", 300]]), membership: metric(40, [["Jan", 38], ["Feb", 42]]) },
    ]
    const agg = aggregateBundleLocationKpis(locs)
    expect(agg.netSales?.lastMonth).toBe(1500)            // 1000 + 500
    expect(agg.membership?.lastMonth).toBe(35)            // (30 + 40) / 2
    expect(agg.netSales?.trend).toEqual([
      { month: "Jan", value: 600 },                       // 400 + 200
      { month: "Feb", value: 900 },                       // 600 + 300
    ])
    expect(agg.membership?.trend).toEqual([
      { month: "Jan", value: 33 },                        // (28 + 38) / 2
      { month: "Feb", value: 37 },                        // (32 + 42) / 2
    ])
  })

  it("preserves chronological trend order (no alphabetical re-sort)", () => {
    const locs: BundleLocationKpi[] = [
      { id: "a", name: "A", netSales: metric(3, [["Jan", 1], ["Feb", 1], ["Mar", 1]]), membership: null },
    ]
    const agg = aggregateBundleLocationKpis(locs)
    expect(agg.netSales?.trend.map(p => p.month)).toEqual(["Jan", "Feb", "Mar"])
  })

  it("ignores null metrics; returns null when none present", () => {
    const locs: BundleLocationKpi[] = [
      { id: "a", name: "A", netSales: metric(100, [["Jan", 100]]), membership: null },
      { id: "b", name: "B", netSales: null, membership: null },
    ]
    const agg = aggregateBundleLocationKpis(locs)
    expect(agg.netSales?.lastMonth).toBe(100)
    expect(agg.membership).toBeNull()
  })

  it("returns both null for an empty list", () => {
    const agg = aggregateBundleLocationKpis([])
    expect(agg.netSales).toBeNull()
    expect(agg.membership).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/bundle.test.ts`
Expected: FAIL — cannot resolve `@/lib/kpi/bundle`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/kpi/bundle.ts`:

```ts
import type { KpiMetric } from "./schema"

export interface BundleLocationKpi {
  id: string
  name: string
  netSales: KpiMetric | null
  membership: KpiMetric | null
}

export interface BundleAggregate {
  netSales: KpiMetric | null
  membership: KpiMetric | null
}

type Mode = "sum" | "average"

// Merge monthly trends across locations. A Map preserves first-seen order, and
// each location's trend is already chronological, so we must NOT re-sort by
// label (labels like "Jan 2025" do not sort chronologically as strings).
function mergeTrend(metrics: KpiMetric[], mode: Mode): { month: string; value: number }[] {
  const acc = new Map<string, { total: number; count: number }>()
  for (const m of metrics) {
    for (const point of m.trend) {
      const e = acc.get(point.month) ?? { total: 0, count: 0 }
      e.total += point.value
      e.count += 1
      acc.set(point.month, e)
    }
  }
  return Array.from(acc.entries()).map(([month, e]) => ({
    month,
    value: mode === "sum" ? e.total : e.total / e.count,
  }))
}

function aggregateOne(metrics: KpiMetric[], mode: Mode): KpiMetric | null {
  if (metrics.length === 0) return null
  const total = metrics.reduce((s, m) => s + m.lastMonth, 0)
  const lastMonth = mode === "sum" ? total : total / metrics.length
  const trend = mergeTrend(metrics, mode)
  const last = trend.length > 0 ? trend[trend.length - 1].value : 0
  const prior = trend.length > 1 ? trend[trend.length - 2].value : 0
  const momChange = prior !== 0 ? (last - prior) / prior : 0
  const updatedAt = metrics.map((m) => m.updatedAt).sort().pop()!
  return { lastMonth, momChange, trend, updatedAt, source: "bigquery" }
}

export function aggregateBundleLocationKpis(locations: BundleLocationKpi[]): BundleAggregate {
  const net = locations.map((l) => l.netSales).filter((m): m is KpiMetric => m !== null)
  const mem = locations.map((l) => l.membership).filter((m): m is KpiMetric => m !== null)
  return {
    netSales: aggregateOne(net, "sum"),
    membership: aggregateOne(mem, "average"),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/kpi/bundle.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpi/bundle.ts src/__tests__/kpi/bundle.test.ts
git commit -m "feat(kpi): pure bundle aggregation (Net Sales sum, MCR avg)"
```

---

### Task 4: `fetchBundleLocationKpis` server fetcher

**Files:**
- Modify: `src/lib/kpi/fetch.ts` (add new function; imports already present)
- Test: `src/__tests__/kpi/bundle-fetch.test.ts`

**Interfaces:**
- Consumes: `getNetSalesByLocation`, `getMcrByLocation`, `getMcrTrendByLocation` from `@/lib/bigquery/queries`; `canFetchLiveData` from `./access`; `BundleLocationKpi` from `./bundle` (Task 3).
- Produces:
  - `function fetchBundleLocationKpis(locations: { id: string; name: string; bqLocationName: string | null; dataMappingStatus: string }[], listingStatus: string): Promise<BundleLocationKpi[]>`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/kpi/bundle-fetch.test.ts` (mirrors `revenue.test.ts` mocking):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getNetSalesByLocation = vi.fn()
const getMcrByLocation = vi.fn()
const getMcrTrendByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({
  getNetSalesByLocation,
  getMcrByLocation,
  getMcrTrendByLocation,
}))

const LOCS = [
  { id: "1", name: "Buckhead", bqLocationName: "Buckhead", dataMappingStatus: "confirmed" },
  { id: "2", name: "Midtown", bqLocationName: "Midtown", dataMappingStatus: "confirmed" },
]

describe("fetchBundleLocationKpis", () => {
  beforeEach(() => {
    vi.resetModules()
    getNetSalesByLocation.mockReset(); getMcrByLocation.mockReset(); getMcrTrendByLocation.mockReset()
  })

  it("returns null metrics for every location when listing is not active", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map())
    getMcrByLocation.mockResolvedValue(new Map())
    getMcrTrendByLocation.mockResolvedValue(new Map())
    const { fetchBundleLocationKpis } = await import("@/lib/kpi/fetch")
    const res = await fetchBundleLocationKpis(LOCS, "draft")
    expect(res).toHaveLength(2)
    expect(res.every(r => r.netSales === null && r.membership === null)).toBe(true)
  })

  it("populates metrics from the maps for connected locations", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map([
      ["Buckhead", { totalCents: 100000, trend: [{ month: "Jan", value: 400 }, { month: "Feb", value: 600 }] }],
    ]))
    getMcrByLocation.mockResolvedValue(new Map([["Buckhead", 32]]))
    getMcrTrendByLocation.mockResolvedValue(new Map([["Buckhead", [{ month: "Jan", value: 30 }, { month: "Feb", value: 34 }]]]))
    const { fetchBundleLocationKpis } = await import("@/lib/kpi/fetch")
    const res = await fetchBundleLocationKpis(LOCS, "active")
    const buckhead = res.find(r => r.id === "1")!
    const midtown = res.find(r => r.id === "2")!
    expect(buckhead.netSales?.lastMonth).toBe(1000)   // 100000 cents -> 1000 dollars
    expect(buckhead.netSales?.source).toBe("bigquery")
    expect(buckhead.membership?.lastMonth).toBe(32)
    expect(midtown.netSales).toBeNull()               // absent from maps
    expect(midtown.membership).toBeNull()
  })

  it("treats a missing bqLocationName as not connected", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map([["Buckhead", { totalCents: 1, trend: [] }]]))
    getMcrByLocation.mockResolvedValue(new Map([["Buckhead", 10]]))
    getMcrTrendByLocation.mockResolvedValue(new Map())
    const { fetchBundleLocationKpis } = await import("@/lib/kpi/fetch")
    const res = await fetchBundleLocationKpis(
      [{ id: "9", name: "No BQ", bqLocationName: null, dataMappingStatus: "confirmed" }],
      "active",
    )
    expect(res[0].netSales).toBeNull()
    expect(res[0].membership).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/bundle-fetch.test.ts`
Expected: FAIL — `fetchBundleLocationKpis` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/kpi/fetch.ts`, add the `BundleLocationKpi` type import near the top (with the other `./` imports):

```ts
import type { BundleLocationKpi } from "./bundle"
```

Append this function at the end of the file (it reuses the same metric-shaping logic as `fetchLocationRevenue`/`fetchLocationMembership`, looking each location up in maps loaded once):

```ts
/**
 * Fetch real BigQuery Net Sales + MCR per bundle location. Loads the cached
 * maps once and looks up each location by bqLocationName (gated like single
 * listings). Locations that are not connected / absent return null metrics but
 * are still included so the caller can list them.
 */
export async function fetchBundleLocationKpis(
  locations: { id: string; name: string; bqLocationName: string | null; dataMappingStatus: string }[],
  listingStatus: string,
): Promise<BundleLocationKpi[]> {
  const [netMap, mcrMap, mcrTrendMap] = await Promise.all([
    getNetSalesByLocation(),
    getMcrByLocation(),
    getMcrTrendByLocation(),
  ])

  return locations.map((loc) => {
    const connected = !!loc.bqLocationName && canFetchLiveData(listingStatus, loc.dataMappingStatus)
    let netSales: KpiMetric | null = null
    let membership: KpiMetric | null = null

    if (connected && loc.bqLocationName) {
      const ns = netMap.get(loc.bqLocationName)
      if (ns) {
        const trend = ns.trend
        const last = trend.length > 0 ? trend[trend.length - 1].value : 0
        const prior = trend.length > 1 ? trend[trend.length - 2].value : 0
        netSales = {
          lastMonth: ns.totalCents / 100,
          momChange: prior !== 0 ? (last - prior) / prior : 0,
          trend,
          updatedAt: new Date().toISOString(),
          source: "bigquery",
        }
      }

      const pct = mcrMap.get(loc.bqLocationName)
      if (pct !== undefined) {
        const points = mcrTrendMap.get(loc.bqLocationName) ?? []
        const trend = points.length > 0 ? points : [{ month: "TTM", value: pct }]
        const last = points.length > 0 ? points[points.length - 1].value : 0
        const prior = points.length > 1 ? points[points.length - 2].value : 0
        membership = {
          lastMonth: pct,
          momChange: points.length > 1 && prior !== 0 ? (last - prior) / prior : 0,
          trend,
          updatedAt: new Date().toISOString(),
          source: "bigquery",
        }
      }
    }

    return { id: loc.id, name: loc.name, netSales, membership }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/kpi/bundle-fetch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpi/fetch.ts src/__tests__/kpi/bundle-fetch.test.ts
git commit -m "feat(kpi): fetchBundleLocationKpis from real BigQuery maps"
```

---

### Task 5: `LocationKpiCards` — optional membership label override

**Files:**
- Modify: `src/components/kpi/LocationKpiCards.tsx:8-11,44-69`

**Interfaces:**
- Consumes: nothing new.
- Produces: `LocationKpiCards` accepts an optional `membershipLabel?: string` prop (default `'Membership Conversion'`), used as the card label for the membership slot only. Modal title is unaffected.

- [ ] **Step 1: Add the prop and apply it to the membership card label**

Update the props interface:

```tsx
interface LocationKpiCardsProps {
  netSales: KpiMetric | null
  membership: KpiMetric | null
  membershipLabel?: string
}
```

Update the component signature and the render to override the label for the `membership` slot:

```tsx
export function LocationKpiCards({ netSales, membership, membershipLabel }: LocationKpiCardsProps) {
  const [open, setOpen] = useState<SlotKey | null>(null)
  const metrics: Record<SlotKey, KpiMetric | null> = { netSales, membership }
  const openSlot = open ? SLOTS.find((s) => s.key === open)! : null
  const openMetric = open ? metrics[open] : null

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {SLOTS.map((slot) => {
          const metric = metrics[slot.key]
          const label = slot.key === 'membership' && membershipLabel ? membershipLabel : slot.cardLabel
          if (!metric) return <PlaceholderCard key={slot.key} label={label} />
          return (
            <KpiCard
              key={slot.key}
              name={label}
              metric={metric}
              formatValue={slot.format}
              onClick={() => setOpen(slot.key)}
              badge="live"
              showDelta={false}
            />
          )
        })}
      </div>
      {/* modal block unchanged */}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Existing single-location callers omit the prop and keep `'Membership Conversion'`.

- [ ] **Step 3: Commit**

```bash
git add src/components/kpi/LocationKpiCards.tsx
git commit -m "feat(kpi): optional membershipLabel on LocationKpiCards"
```

---

### Task 6: Rewrite `BundleKpiSection` — per-location table + drill-in modal

**Files:**
- Rewrite: `src/components/kpi/BundleKpiSection.tsx` (full file replacement)

**Interfaces:**
- Consumes: `BundleLocationKpi` from `@/lib/kpi/bundle` (Task 3); `KpiTrendChart` from `./KpiTrendChart`.
- Produces:
  - `BundleKpiSection` now takes `{ locations: BundleLocationKpi[]; territories: { id: string; name: string }[] }`.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/components/kpi/BundleKpiSection.tsx` with:

```tsx
'use client'

import { useState, useMemo } from 'react'
import type { BundleLocationKpi } from '@/lib/kpi/bundle'
import { KpiTrendChart } from './KpiTrendChart'

interface BundleKpiSectionProps {
  locations: BundleLocationKpi[]
  territories: { id: string; name: string }[]
}

type SortKey = 'name' | 'netSales' | 'membership'
type SortDirection = 'asc' | 'desc'

const formatDollars = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const formatPct = (v: number) => `${v.toFixed(1)}%`

export function BundleKpiSection({ locations, territories }: BundleKpiSectionProps) {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  const sorted = useMemo(() => {
    return [...locations].sort((a, b) => {
      let cmp: number
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else {
        const av = a[sortKey]?.lastMonth ?? -1
        const bv = b[sortKey]?.lastMonth ?? -1
        cmp = av - bv
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [locations, sortKey, sortDirection])

  const selected = selectedId ? locations.find((l) => l.id === selectedId) ?? null : null

  const SortArrow = ({ columnKey }: { columnKey: SortKey }) =>
    sortKey !== columnKey ? null : (
      <span className="ml-1 text-hs-red-600">{sortDirection === 'asc' ? '↑' : '↓'}</span>
    )

  return (
    <div className="mt-8 space-y-6">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('name')}>
                Location<SortArrow columnKey="name" />
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('netSales')}>
                Net Sales (TTM)<SortArrow columnKey="netSales" />
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" onClick={() => handleSort('membership')}>
                MCR<SortArrow columnKey="membership" />
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sorted.map((loc) => (
              <tr
                key={loc.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => setSelectedId(loc.id)}
              >
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-hs-red-700">{loc.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {loc.netSales ? formatDollars(loc.netSales.lastMonth) : '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {loc.membership ? formatPct(loc.membership.lastMonth) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {territories.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Unopened Territories</h3>
          <ul className="list-disc list-inside text-sm text-gray-600">
            {territories.map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
          </ul>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedId(null)} aria-hidden="true" />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-8" role="dialog" aria-modal="true">
            <button
              onClick={() => setSelectedId(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 className="text-xl font-semibold text-gray-900 mb-6">{selected.name}</h3>

            <div className="space-y-8">
              <div>
                <p className="text-sm text-gray-500 mb-1">Net Sales (TTM · Cash + Credit)</p>
                <p className="text-3xl font-semibold text-gray-900 mb-3">
                  {selected.netSales ? formatDollars(selected.netSales.lastMonth) : '—'}
                </p>
                {selected.netSales && selected.netSales.trend.length >= 2 && (
                  <KpiTrendChart data={selected.netSales.trend} label="Net Sales" formatValue={formatDollars} height={200} />
                )}
              </div>

              <div>
                <p className="text-sm text-gray-500 mb-1">Membership Conversion</p>
                <p className="text-3xl font-semibold text-gray-900 mb-3">
                  {selected.membership ? formatPct(selected.membership.lastMonth) : '—'}
                </p>
                {selected.membership && selected.membership.trend.length >= 2 && (
                  <KpiTrendChart data={selected.membership.trend} label="MCR" formatValue={formatPct} height={200} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck (expected to still fail at the call site)**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/components/kpi/KpiSection.tsx` (still calling the old `BundleKpiSection` signature). `BundleKpiSection.tsx` itself compiles. The KpiSection error is resolved in Task 7. (`KpiTrendChart` import path/props match the prior `BundleKpiTable` usage: `data`, `label`, `formatValue`, `height`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/kpi/BundleKpiSection.tsx
git commit -m "feat(kpi): bundle per-location table with drill-in modal"
```

---

### Task 7: Wire the bundle branch in `KpiSection` + pass per-location data from the page

**Files:**
- Modify: `src/components/kpi/KpiSection.tsx:1-28,103-143`
- Modify: `src/app/listings/[id]/page.tsx:153-161`

**Interfaces:**
- Consumes: `fetchBundleLocationKpis` (Task 4), `aggregateBundleLocationKpis` (Task 3), `LocationKpiCards` w/ `membershipLabel` (Task 5), rewritten `BundleKpiSection` (Task 6).
- Produces: final rendered bundle performance section.

- [ ] **Step 1: Extend the `Location` interface and imports in `KpiSection.tsx`**

Replace the imports for the removed mock path and add the new ones. Change lines 1-6 to:

```tsx
import { Suspense } from 'react'
import { fetchLocationRevenue, fetchLocationMembership, fetchLocationReviews, fetchBundleLocationKpis } from '@/lib/kpi/fetch'
import { aggregateBundleLocationKpis } from '@/lib/kpi/bundle'
import { LocationKpiCards } from './LocationKpiCards'
import { BundleKpiSection } from './BundleKpiSection'
import { LocationReviewsPanel } from './LocationReviewsPanel'
```

Extend the `Location` interface (lines 9-13) to carry the data the fetcher needs:

```tsx
interface Location {
  id: string
  name: string
  type: 'suite' | 'flagship' | 'territory'
  bqLocationName?: string | null
  dataMappingStatus?: string
}
```

- [ ] **Step 2: Replace the bundle branch**

Replace the bundle branch (current lines 103-143, from `// Bundle listing` through its closing `}`) with:

```tsx
  // Bundle listing — real BigQuery Net Sales + MCR, aggregate + per-location drill-in.
  if (listingType === 'bundle' && bundleLocations?.length) {
    const openLocations = bundleLocations.filter((loc) => loc.type !== 'territory')
    const territories = bundleLocations.filter((loc) => loc.type === 'territory')

    if (openLocations.length === 0) {
      return null // nothing operational to show
    }

    const perLocation = await fetchBundleLocationKpis(
      openLocations.map((l) => ({
        id: l.id,
        name: l.name,
        bqLocationName: l.bqLocationName ?? null,
        dataMappingStatus: l.dataMappingStatus ?? 'not_connected',
      })),
      listingStatus ?? '',
    )
    const aggregate = aggregateBundleLocationKpis(perLocation)
    const anyLive = perLocation.some((l) => l.netSales || l.membership)

    return (
      <section className="mt-12">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-gray-900">
            Performance Data ({openLocations.length} locations)
          </h2>
          {anyLive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-lg">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Verified by Hello Sugar
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-6">
          {anyLive
            ? 'Aggregate across the bundle — Net Sales summed, MCR averaged (trailing 12 months). Tap a location for its detail.'
            : 'Live data not connected for these locations.'}
        </p>

        <LocationKpiCards
          netSales={aggregate.netSales}
          membership={aggregate.membership}
          membershipLabel="Membership Conversion (avg.)"
        />

        <BundleKpiSection
          locations={perLocation}
          territories={territories.map((t) => ({ id: t.id, name: t.name }))}
        />
      </section>
    )
  }
```

- [ ] **Step 3: Pass the new fields from the listing detail page**

In `src/app/listings/[id]/page.tsx`, update the `bundleLocations` prop mapping (lines 153-161) to include the two new fields:

```tsx
            bundleLocations={
              listing.type === 'bundle'
                ? listing.locations.map(loc => ({
                    id: loc.id,
                    name: loc.name,
                    type: loc.locationType === 'territory' ? 'territory' : 'suite',
                    bqLocationName: loc.bqLocationName,
                    dataMappingStatus: loc.dataMappingStatus,
                  }))
                : undefined
            }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (Tasks 3-6 plus this task now fully type-check together).

- [ ] **Step 5: Run the full KPI test suite**

Run: `npx vitest run src/__tests__/kpi`
Expected: PASS, including the new `bundle.test.ts` and `bundle-fetch.test.ts`. (The legacy `aggregate.test.ts` / `fetchBundleKpi` tests still pass here — they are removed in Task 8.)

- [ ] **Step 6: Manual verification note**

On a bundle listing detail page: header reads "Performance Data (N locations)" with the Verified badge when any location is live; aggregate Net Sales + "Membership Conversion (avg.)" cards render; the per-location table lists each open salon with Net Sales + MCR; clicking a row opens a modal with that location's value and 12-month trend chart(s); territories appear under "Unopened Territories".

- [ ] **Step 7: Commit**

```bash
git add src/components/kpi/KpiSection.tsx src/app/listings/[id]/page.tsx
git commit -m "feat(kpi): bundle performance on real BigQuery with aggregate + drill-in"
```

---

### Task 8: Remove the dead mock bundle code path

**Files:**
- Delete: `src/components/kpi/BundleKpiTable.tsx`
- Delete: `src/components/kpi/BundleOverlayChart.tsx`
- Delete: `src/components/kpi/KpiCardRow.tsx`
- Delete: `src/lib/kpi/aggregate.ts`
- Delete: `src/__tests__/kpi/aggregate.test.ts`
- Delete: `src/app/api/kpi/bundle/route.ts`
- Modify: `src/lib/kpi/fetch.ts` (remove `fetchBundleKpi` + drop `generateMockBundleKpi` from the import)
- Modify: `src/lib/kpi/mock-data.ts` (remove `generateMockBundleKpi`)
- Modify: `src/__tests__/kpi/fetch.test.ts` (remove the `fetchBundleKpi` describe block)

**Interfaces:**
- Consumes: nothing (removal only).
- Produces: nothing.

- [ ] **Step 1: Confirm nothing still references the symbols being removed**

Run: `npx grep -rn "fetchBundleKpi\|aggregateBundleKpi\|generateMockBundleKpi\|KpiCardRow\|BundleOverlayChart\|BundleKpiTable\|api/kpi/bundle" src` (or the Grep tool).
Expected: matches ONLY inside the files listed above (definitions + the tests being removed). If anything else references them, stop and reconcile before deleting.

- [ ] **Step 2: Delete the dead component, lib, route, and test files**

```bash
git rm src/components/kpi/BundleKpiTable.tsx \
       src/components/kpi/BundleOverlayChart.tsx \
       src/components/kpi/KpiCardRow.tsx \
       src/lib/kpi/aggregate.ts \
       src/__tests__/kpi/aggregate.test.ts \
       src/app/api/kpi/bundle/route.ts
```

- [ ] **Step 3: Remove `fetchBundleKpi` and fix the import in `fetch.ts`**

In `src/lib/kpi/fetch.ts`: change the mock-data import from
`import { mockLocationKpi, generateMockBundleKpi } from "./mock-data"` to
`import { mockLocationKpi } from "./mock-data"`, and delete the entire
`fetchBundleKpi` function (the `export async function fetchBundleKpi(...)` block, ~lines 80-107). Leave `fetchLocationKpi` and the BigQuery-backed fetchers intact.

- [ ] **Step 4: Remove `generateMockBundleKpi` from `mock-data.ts`**

In `src/lib/kpi/mock-data.ts`, delete the `export function generateMockBundleKpi(...)` definition (and any helper/import that becomes unused only because of its removal — keep `mockLocationKpi` and anything `fetchLocationKpi` still needs).

- [ ] **Step 5: Remove the `fetchBundleKpi` tests**

In `src/__tests__/kpi/fetch.test.ts`, delete the entire `describe("fetchBundleKpi", ...)` block (lines 117-182). Keep the `describe("fetchLocationKpi", ...)` block.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no dangling references).

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green, with no `aggregate.test.ts` and no `fetchBundleKpi` tests remaining.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(kpi): remove legacy mock bundle KPI path"
```

---

## Self-Review

**Spec coverage:**
- Territory: TTM Profit removed on detail (Task 1) and form (Task 2). ✅
- Bundle real-data fetch (Net Sales + MCR), no N+1 (Task 4). ✅
- Aggregate: Net Sales sum, MCR labeled average (Task 3 + Task 5 label + Task 7 wiring). ✅
- Per-location drill-in modal (Task 6, wired Task 7). ✅
- "Not connected" placeholders when no live data; null when no open locations (Task 7). ✅
- Territories listed separately (Task 6 + Task 7). ✅
- Remove dead mock path: `fetchBundleKpi`, `aggregateBundleKpi`, `BundleOverlayChart`, mock columns, plus discovered extras (`BundleKpiTable`, `KpiCardRow`, `generateMockBundleKpi`, unused `api/kpi/bundle` route) (Task 8). ✅
- Out of scope honored: no bundle reviews panel; BigQuery MCR-count change deferred. ✅

**Placeholder scan:** No TBD/TODO; every code step contains full code.

**Type consistency:** `BundleLocationKpi` defined in Task 3, imported by Tasks 4/6/7. `aggregateBundleLocationKpis`/`fetchBundleLocationKpis`/`membershipLabel` names match across definition and call sites. `KpiTrendChart` props (`data`, `label`, `formatValue`, `height`) match its existing usage. MCR percent units and Net Sales dollar units consistent with `fetchLocationRevenue`/`fetchLocationMembership`.
