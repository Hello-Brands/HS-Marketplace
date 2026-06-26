# Listing-Detail Financials / Performance Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the listing-detail page, remove the duplicated Net Sales/Revenue display, give the surviving (clickable) card a tight label with the full phrase in its trend modal, drop the misleading per-card month-over-month arrow, and show "Not connected" placeholders instead of mock data.

**Architecture:** Display-layer only. The single-location Performance Data section is re-sourced to use BigQuery Net Sales + MCR directly (dropping the mock/internal-API base) and renders two fixed slots via a new focused client component that shows an interactive card when live and a static placeholder when not. The Financials section drops its duplicate Net Sales card.

**Tech Stack:** Next.js App Router (this is a MODIFIED Next.js — consult `node_modules/next/dist/docs/` before adding framework code), React 18, Drizzle (unchanged here), BigQuery (queries unchanged), Tailwind, Vitest.

## Global Constraints

- **Display-only change.** No database schema, listing creation wizard, edit forms, BigQuery SQL/queries, or **bundle** KPI path may change.
- **Keep TTM Profit** (card + the listing-form input) exactly as today.
- **Tight card label** = `Net Sales (TTM · Cash + Credit)`; **full modal title** = `Net Sales (Trailing 12 Months, Cash + Credit)` (exact strings, verbatim).
- **No per-card MoM arrow** on the single-location Net Sales and Membership Conversion cards; the monthly chart stays in the trend modal.
- **Never show mock under the Net Sales label.** The single-location Performance Data cards come **purely from BigQuery**; not connected → a muted "— / Not connected" placeholder (no modal, no badge).
- **`fetchLocationKpi` and `mockLocationKpi` must NOT be removed** — still used by the bundle path (`fetchBundleKpi`) and the `/api/kpi/[locationId]` route. Only `buildLocationKpi` (and its test) are removed.
- Live-data gate is unchanged: `listingStatus === 'active' && mappingStatus === 'confirmed'` plus a `bqLocationName` match (inside `fetchLocationRevenue`/`fetchLocationMembership`).
- **Build gate:** use `npx tsc --noEmit` as the per-task gate (a running dev server can hold the Windows `.next` lock; do NOT run `next build` mid-task). Run the vitest suite where a task changes tests. One full `npm run build` is run by the controller at the end with the dev server stopped.

---

### Task 1: Add `showDelta` prop to `KpiCard`

**Files:**
- Modify: `src/components/kpi/KpiCard.tsx`

**Interfaces:**
- Produces: `KpiCard` gains optional prop `showDelta?: boolean` (default `true`). When `false`, the MoM change line is not rendered. All existing callers (bundle cards via `KpiCardRow`) keep current behaviour because the default is `true`.

- [ ] **Step 1: Add the prop and gate the MoM line**

In `src/components/kpi/KpiCard.tsx`, change the props interface (currently lines 6-12) to add `showDelta`:
```tsx
interface KpiCardProps {
  name: string
  metric: KpiMetric
  formatValue: (value: number) => string
  onClick: () => void
  badge: KpiBadge
  showDelta?: boolean
}
```
Change the function signature (currently line 14) to destructure it with a default:
```tsx
export function KpiCard({ name, metric, formatValue, onClick, badge, showDelta = true }: KpiCardProps) {
```
Replace the MoM Change paragraph (currently lines 40-41):
```tsx
      {/* MoM Change */}
      <p className="text-sm text-gray-600 mb-2">{formatMomChange(metric.momChange)}</p>
```
with a gated version:
```tsx
      {/* MoM Change */}
      {showDelta && (
        <p className="text-sm text-gray-600 mb-2">{formatMomChange(metric.momChange)}</p>
      )}
```
Leave `formatMomChange` and everything else unchanged.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/kpi/KpiCard.tsx
git commit -m "feat(kpi): add optional showDelta prop to KpiCard"
```

---

### Task 2: New `LocationKpiCards` component

**Files:**
- Create: `src/components/kpi/LocationKpiCards.tsx`

**Interfaces:**
- Consumes: `KpiCard` (with `showDelta` from Task 1), `KpiTrendModal`, `KpiMetric` type.
- Produces: `LocationKpiCards({ netSales, membership }: { netSales: KpiMetric | null; membership: KpiMetric | null })` — a client component rendering exactly two slots in order (Net Sales, then Membership Conversion). A present metric → interactive `KpiCard` (clickable → `KpiTrendModal`, `showDelta={false}`, `badge="live"`); a null metric → a static "— / Not connected" placeholder. Net Sales formats as whole-dollar currency; MCR formats as one-decimal percent.

- [ ] **Step 1: Create the component**

`src/components/kpi/LocationKpiCards.tsx`:
```tsx
'use client'

import { useState } from 'react'
import type { KpiMetric } from '@/lib/kpi/schema'
import { KpiCard } from './KpiCard'
import { KpiTrendModal } from './KpiTrendModal'

interface LocationKpiCardsProps {
  netSales: KpiMetric | null
  membership: KpiMetric | null
}

type SlotKey = 'netSales' | 'membership'

const formatDollars = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
const formatPct = (v: number) => `${v.toFixed(1)}%`

// Card label is tight; the trend modal shows the full descriptive phrase.
const SLOTS = [
  {
    key: 'netSales' as const,
    cardLabel: 'Net Sales (TTM · Cash + Credit)',
    modalTitle: 'Net Sales (Trailing 12 Months, Cash + Credit)',
    format: formatDollars,
  },
  {
    key: 'membership' as const,
    cardLabel: 'Membership Conversion',
    modalTitle: 'Membership Conversion',
    format: formatPct,
  },
] as const

function PlaceholderCard({ label }: { label: string }) {
  return (
    <div className="relative min-h-[120px] rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-xs font-normal text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-3xl font-semibold text-gray-300 mb-2">—</p>
      <p className="text-xs text-gray-400">Not connected</p>
    </div>
  )
}

export function LocationKpiCards({ netSales, membership }: LocationKpiCardsProps) {
  const [open, setOpen] = useState<SlotKey | null>(null)

  const metrics: Record<SlotKey, KpiMetric | null> = { netSales, membership }
  const openSlot = open ? SLOTS.find((s) => s.key === open)! : null
  const openMetric = open ? metrics[open] : null

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {SLOTS.map((slot) => {
          const metric = metrics[slot.key]
          if (!metric) return <PlaceholderCard key={slot.key} label={slot.cardLabel} />
          return (
            <KpiCard
              key={slot.key}
              name={slot.cardLabel}
              metric={metric}
              formatValue={slot.format}
              onClick={() => setOpen(slot.key)}
              badge="live"
              showDelta={false}
            />
          )
        })}
      </div>

      {openSlot && openMetric && (
        <KpiTrendModal
          isOpen={open !== null}
          onClose={() => setOpen(null)}
          title={openSlot.modalTitle}
          metric={openMetric}
          formatValue={openSlot.format}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Component not yet imported anywhere — that's fine; wired in Task 3.)

- [ ] **Step 3: Commit**

```bash
git add src/components/kpi/LocationKpiCards.tsx
git commit -m "feat(kpi): add LocationKpiCards (Net Sales + MCR, interactive or placeholder)"
```

---

### Task 3: Re-source the single-location Performance Data (BigQuery-only) and remove dead `buildLocationKpi`

**Files:**
- Modify: `src/components/kpi/KpiSection.tsx`
- Delete: `src/lib/kpi/assemble.ts`
- Delete: `src/__tests__/kpi/assemble.test.ts`

**Interfaces:**
- Consumes: `LocationKpiCards` (Task 2); `fetchLocationRevenue`, `fetchLocationMembership` (existing).
- Produces: the single-location Performance Data section now renders for every non-territory single-location listing (live cards or placeholders), sourced purely from BigQuery. `buildLocationKpi` no longer exists.

- [ ] **Step 1: Rewrite the single-location branch and imports**

In `src/components/kpi/KpiSection.tsx`, change the imports at the top (currently lines 2-6) to drop `fetchLocationKpi` and `buildLocationKpi`, and add `LocationKpiCards`:
```tsx
import { Suspense } from 'react'
import { fetchBundleKpi, fetchLocationRevenue, fetchLocationMembership } from '@/lib/kpi/fetch'
import { aggregateBundleKpi } from '@/lib/kpi/aggregate'
import { KpiCardRow } from './KpiCardRow'
import { LocationKpiCards } from './LocationKpiCards'
import { BundleKpiSection } from './BundleKpiSection'
```
Replace the entire single-location block (currently lines 50-88, the `// Single location` `if (listingType !== 'bundle' && locationId) { ... }` block) with:
```tsx
  // Single location — Net Sales + MCR come straight from BigQuery; New Clients
  // and Bookings have no live source, so they are not shown. When a location is
  // not connected we render placeholders rather than hide the section.
  if (listingType !== 'bundle' && locationId) {
    let rev: Awaited<ReturnType<typeof fetchLocationRevenue>> = null
    let mem: Awaited<ReturnType<typeof fetchLocationMembership>> = null
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
    }

    const netSales = rev?.metric ?? null
    const revenueLive = netSales !== null

    return (
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Performance Data</h2>
        <p className="text-sm text-gray-500 mb-6">
          {revenueLive
            ? "Net Sales and MCR are live from BigQuery (trailing 12 months)."
            : "Live data not connected for this location."}
        </p>
        <LocationKpiCards netSales={netSales} membership={mem} />
      </section>
    )
  }
```
Leave the bundle branch (the `if (listingType === 'bundle' && bundleLocations?.length)` block) and the final `return null` unchanged. `KpiCardRow` stays imported because the bundle branch still uses it.

- [ ] **Step 2: Delete the now-dead assemble module and its test**

```bash
git rm src/lib/kpi/assemble.ts src/__tests__/kpi/assemble.test.ts
```
(`buildLocationKpi` had only two callers: the single-location branch just rewritten, and `assemble.test.ts`. Both are now gone.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no remaining references to `buildLocationKpi` or `fetchLocationKpi` in `KpiSection.tsx`).

- [ ] **Step 4: Run the test suite**

Run: `npm run test`
Expected: PASS. The `assemble` test file (4 tests) is gone, so the suite is now **210 tests across 29 files** (down from 214/30). No other test references `buildLocationKpi`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(kpi): single-location Performance Data is BigQuery-only with placeholders; drop buildLocationKpi"
```

---

### Task 4: Trim the Financials section (remove the duplicate Net Sales card)

**Files:**
- Modify: `src/components/listing-detail/FinancialsGrid.tsx`
- Modify: `src/app/listings/[id]/page.tsx`

**Interfaces:**
- Produces: `FinancialsGrid({ listing }: { listing: ListingDetail })` — no longer accepts `netSalesTtm` or `hasSalonLocations`. Renders Asking Price + TTM Profit + Included Assets only.

- [ ] **Step 1: Remove the Net Sales card and props from `FinancialsGrid`**

In `src/components/listing-detail/FinancialsGrid.tsx`, change the props interface (currently lines 3-7) to:
```tsx
interface FinancialsGridProps {
  listing: ListingDetail
}
```
Change the component signature (currently line 58) to:
```tsx
export function FinancialsGrid({ listing }: FinancialsGridProps) {
```
Replace the metrics grid (currently lines 61-94 — the `<div className="grid ...">` containing Asking Price, TTM Profit, and the `netSalesTtm` conditional) with this two-card grid:
```tsx
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricCard
          label="Asking Price"
          value={formatPrice(listing.askingPrice)}
          variant="primary"
        />
        <MetricCard
          label="TTM Profit"
          value={formatPrice(listing.ttmProfit)}
          subLabel="Trailing 12 months"
        />
      </div>
```
Leave `formatPrice`, `MetricCard`, and the Included Assets block (the divider + `Included Assets` card) unchanged.

- [ ] **Step 2: Remove the Net Sales computation and prop wiring in `page.tsx`**

In `src/app/listings/[id]/page.tsx`:

Remove the now-unused import (currently line 5):
```tsx
import { fetchLocationRevenue } from '@/lib/kpi/fetch'
```
Remove the entire Net Sales computation block (currently lines 54-68 — the comment `// Compute BigQuery trailing-12-month net sales ...` through the `const netSalesTtm = ...` assignment, i.e. `salonLocations`, `revenueResults`, `connected`, and `netSalesTtm`). Note `primaryLocation` is computed separately just below and does NOT depend on `salonLocations`, so it stays.

Change the `<FinancialsGrid ... />` usage (currently line 159) to:
```tsx
            <FinancialsGrid listing={listing} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no remaining references to `netSalesTtm`, `salonLocations`, or `fetchLocationRevenue` in `page.tsx`).

- [ ] **Step 4: Commit**

```bash
git add src/components/listing-detail/FinancialsGrid.tsx src/app/listings/[id]/page.tsx
git commit -m "feat(listing-detail): drop duplicate Net Sales card from Financials"
```

---

## Self-Review

**Spec coverage:**
- Remove Financials Net Sales duplicate → Task 4. ✓
- Keep the clickable Performance Data card, tight label + full modal title → Tasks 2 (labels) + 3 (wiring). ✓
- Remove per-card MoM arrow → Task 1 (`showDelta`) + Task 2 (`showDelta={false}`). ✓
- BigQuery-only sourcing, drop mock base → Task 3. ✓
- Always render section for non-territory single locations; "Not connected" placeholders → Tasks 2 (placeholder) + 3 (always render). ✓
- Subtitle live/not-connected text → Task 3. ✓
- Remove `buildLocationKpi` + test; keep `fetchLocationKpi`/`mockLocationKpi` → Task 3 (delete) + Global Constraints (keep). ✓
- Keep TTM Profit, bundle path, wizard/edit/DB/BQ untouched → none of those files are in any task's file list. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `LocationKpiCards({ netSales, membership })` props (Task 2) match the call site in Task 3. `KpiCard`'s new `showDelta?: boolean` (Task 1) matches its use in Task 2. `FinancialsGrid({ listing })` (Task 4) matches the `page.tsx` call site updated in the same task. Exact label strings (`Net Sales (TTM · Cash + Credit)`, `Net Sales (Trailing 12 Months, Cash + Credit)`) are identical across spec and Task 2. ✓

**Note for executor:** Line numbers reference the files' state at plan-writing time; locate edits by the quoted anchor code, not the line number.
