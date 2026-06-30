# Marketplace Browse Bar Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the `/browse` filter bar (prominent location search, one listing-type dropdown, a consolidated "Filters" dropdown, sort on the right), add a buyer-visible inventory-cost field to the intake/edit forms and listing detail, and add an inventory-included browse filter wired through query, saved searches, and alerts.

**Architecture:** URL search params (nuqs) remain the single source of truth for browse filters; `FilterBar` reads/writes them and `BrowsePage` derives the `ListingFilters` passed to the `getListings` server action. The inventory cost is a new nullable cents column on `listings`, surfaced through the existing form → action → detail pipeline. The inventory filter is a new boolean param threaded through `getListings`, `SaveSearchButton`/`alerts`, and the pure `listingMatchesAlert` function.

**Tech Stack:** Next.js 15 (App Router), React 18, TypeScript, Drizzle ORM (Neon Postgres, push-managed), nuqs, react-hook-form + zod, MapTiler GeocodingControl, Tailwind, Vitest.

## Global Constraints

- **Node 24.x** (`engines.node`); the repo targets Next.js 15 App Router with the in-repo docs at `node_modules/next/dist/docs/` as the source of truth for Next APIs.
- **Money is stored in cents** as `integer` columns; forms enter/display whole dollars and multiply/divide by 100 (mirror `askingPrice`).
- **DB is push-managed** via `npm run db:push` (drizzle-kit push against Neon). No SQL migration files are hand-written. `.env.local` in this checkout holds `DATABASE_URL_DIRECT`/`DATABASE_URL`.
- **Bundle stays in the data model.** Remove `bundle` only from the browse *filter options*. The `listing_type` enum, existing bundle rows, and bundle creation (auto-derived in `saveDraft` when a listing has >1 location) are untouched.
- **Windows build lock:** stop the dev server before any `next build`. Use `npx tsc --noEmit` for per-task type gates. `npm run lint` is pre-existing broken — do not gate on it.
- **Test runner:** `npm test` runs `vitest run`. Single file: `npx vitest run <path>`.
- **Brand:** crimson actions use the existing `hs-red-*` Tailwind classes; body text stays gray/ink. Reuse existing components (`FilterPopover`, `Button`, `StatePanel`) — do not invent new primitives.

---

## Phase 1 — Inventory cost field (data → forms → detail)

### Task 1: Add `inventoryCostEstimate` to the data model, types, and validation

**Files:**
- Modify: `src/db/schema/listings.ts:37` (after `otherAssets`)
- Modify: `src/lib/listings/types.ts:45` (in `ListingFormData`)
- Modify: `src/lib/listings/schemas.ts:83` (in `photosDetailsSchema`) and `:98` (`getFieldsForStep` step 3)
- Test: `src/__tests__/listings/inventory-cost-schema.test.ts` (create)

**Interfaces:**
- Produces: `listings.inventoryCostEstimate` (nullable `integer`, cents); `ListingFormData.inventoryCostEstimate?: number` (whole dollars in the form); `photosDetailsSchema` accepts optional non-negative `inventoryCostEstimate`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/listings/inventory-cost-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { photosDetailsSchema } from "@/lib/listings/schemas"

const validBase = {
  photos: [{ id: "1", url: "https://example.com/a.jpg", filename: "a.jpg", order: 0 }],
  inventoryIncluded: true,
  laserIncluded: false,
}

describe("photosDetailsSchema inventoryCostEstimate", () => {
  it("is optional", () => {
    expect(photosDetailsSchema.safeParse(validBase).success).toBe(true)
  })
  it("accepts a non-negative number", () => {
    expect(photosDetailsSchema.safeParse({ ...validBase, inventoryCostEstimate: 25000 }).success).toBe(true)
  })
  it("rejects a negative number", () => {
    expect(photosDetailsSchema.safeParse({ ...validBase, inventoryCostEstimate: -1 }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/listings/inventory-cost-schema.test.ts`
Expected: FAIL (negative value currently passes because the field is unknown / stripped).

- [ ] **Step 3: Add the zod field and step-field list**

In `src/lib/listings/schemas.ts`, inside `photosDetailsSchema` (after the `laserIncluded` line):

```ts
  laserIncluded: z.boolean(),
  inventoryCostEstimate: z.number().nonnegative('Enter a valid amount').optional(),
```

And in `getFieldsForStep`, case 3:

```ts
    case 3:
      return ['photos', 'inventoryIncluded', 'laserIncluded', 'inventoryCostEstimate', 'otherAssets', 'notes']
```

- [ ] **Step 4: Add the form type**

In `src/lib/listings/types.ts`, inside `ListingFormData` after `laserIncluded`:

```ts
  inventoryIncluded: boolean
  laserIncluded: boolean
  // Whole dollars in the form; persisted as cents. Only meaningful when inventoryIncluded.
  inventoryCostEstimate?: number
```

- [ ] **Step 5: Add the DB column**

In `src/db/schema/listings.ts`, after the `otherAssets` line:

```ts
  otherAssets: text("other_assets"),
  // Seller's estimated value of included inventory (cents). Null when no inventory.
  inventoryCostEstimate: integer("inventory_cost_estimate"),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/listings/inventory-cost-schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Push the schema and type-check**

Run: `npm run db:push` (expected: drizzle reports adding column `inventory_cost_estimate` to `listings`, no data loss).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/listings.ts src/lib/listings/types.ts src/lib/listings/schemas.ts src/__tests__/listings/inventory-cost-schema.test.ts
git commit -m "feat(listings): add inventoryCostEstimate column, type, and validation"
```

---

### Task 2: Persist `inventoryCostEstimate` in create/update actions

**Files:**
- Modify: `src/lib/listings/actions.ts:42-44` (update branch) and `:75-77` (insert branch)

**Interfaces:**
- Consumes: `ListingFormData.inventoryCostEstimate` (dollars), `data.inventoryIncluded`.
- Produces: writes `listings.inventoryCostEstimate` in cents, or `null` when inventory is not included.

- [ ] **Step 1: Add the mapping to the update branch**

In `src/lib/listings/actions.ts`, in the `db.update(listings).set({ ... })` block, after `otherAssets: data.otherAssets,`:

```ts
        otherAssets: data.otherAssets,
        // Clear the cost when inventory isn't included so we never persist a stale value.
        inventoryCostEstimate:
          data.inventoryIncluded && data.inventoryCostEstimate
            ? Math.round(data.inventoryCostEstimate * 100)
            : null,
```

- [ ] **Step 2: Add the mapping to the insert branch**

In the `db.insert(listings).values({ ... })` block, after `otherAssets: data.otherAssets,`:

```ts
      otherAssets: data.otherAssets,
      inventoryCostEstimate:
        data.inventoryIncluded && data.inventoryCostEstimate
          ? Math.round(data.inventoryCostEstimate * 100)
          : null,
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/listings/actions.ts
git commit -m "feat(listings): persist inventory cost estimate (cents) on save"
```

---

### Task 3: Add the inventory-cost input to the intake wizard

**Files:**
- Modify: `src/components/listings/steps/PhotosDetailsStep.tsx:17` (watch) and `:66` (after the inventory checkbox)

**Interfaces:**
- Consumes: `register`, `watch` from `useFormContext<ListingFormData>()`; field name `inventoryCostEstimate`.

- [ ] **Step 1: Watch the inventory toggle**

In `PhotosDetailsStep.tsx`, change the destructure to also read the toggle:

```ts
  const { register, control, watch, formState: { errors } } = useFormContext<ListingFormData>()
  const photos = watch('photos') || []
  const inventoryIncluded = watch('inventoryIncluded')
```

- [ ] **Step 2: Render the conditional cost field**

Insert immediately after the closing `</label>` of the `inventoryIncluded` checkbox (after line 66), still inside the `space-y-3` div:

```tsx
          {inventoryIncluded && (
            <div className="ml-8">
              <label htmlFor="inventoryCostEstimate" className="block text-sm font-medium text-gray-700 mb-1">
                Estimated value of inventory included (optional)
              </label>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  id="inventoryCostEstimate"
                  type="number"
                  min="0"
                  {...register('inventoryCostEstimate', {
                    setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                  })}
                  placeholder="0"
                  className="w-full pl-7 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-hs-red-500 focus:border-hs-red-500 min-h-[44px]"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">Shown to buyers on your listing.</p>
            </div>
          )}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Visual check**

If a dev server is already running, open `/listings/new`, go to step 3, toggle "Inventory…" — the dollar field appears only when checked. (Do not start a server solely for this; rely on tsc + reviewer.)

- [ ] **Step 5: Commit**

```bash
git add src/components/listings/steps/PhotosDetailsStep.tsx
git commit -m "feat(listings): inventory cost input in intake wizard (conditional)"
```

---

### Task 4: Add the inventory-cost input + prefill to the edit form

**Files:**
- Modify: `src/components/listings/ListingEditForm.tsx:31` (watch) and `:168` (after the inventory checkbox in the Assets card)
- Modify: `src/app/seller/listings/[id]/edit/page.tsx:70` (initialData)
- Modify: `src/app/admin/listings/[id]/edit/page.tsx:65` (initialData)

**Interfaces:**
- Consumes: `listing.inventoryCostEstimate` (cents) from the DB row.
- Produces: `initialData.inventoryCostEstimate` (dollars) prefill; same `inventoryCostEstimate` form field as Task 3.

- [ ] **Step 1: Watch the toggle in the edit form**

In `ListingEditForm.tsx`, change:

```ts
  const { register, control, watch, formState: { errors } } = methods
  const photos = watch('photos') || []
  const inventoryIncluded = watch('inventoryIncluded')
```

- [ ] **Step 2: Render the conditional field in the Assets card**

Insert after the `laserIncluded` label's closing `</label>` but **inside** the `space-y-3` div (after line 167), then before the existing "Other Assets" block:

```tsx
            {inventoryIncluded && (
              <div className="pt-1">
                <label htmlFor="inventoryCostEstimate" className="block text-sm font-medium text-gray-700 mb-1">
                  Estimated value of inventory included
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3 top-2 text-gray-500">$</span>
                  <input
                    id="inventoryCostEstimate"
                    type="number"
                    min="0"
                    {...register('inventoryCostEstimate', {
                      setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                    })}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            )}
```

- [ ] **Step 3: Prefill in the seller edit loader**

In `src/app/seller/listings/[id]/edit/page.tsx`, in the `initialData` object after `laserIncluded: listing.laserIncluded,`:

```ts
    inventoryIncluded: listing.inventoryIncluded,
    laserIncluded: listing.laserIncluded,
    inventoryCostEstimate:
      listing.inventoryCostEstimate != null ? listing.inventoryCostEstimate / 100 : undefined,
```

- [ ] **Step 4: Prefill in the admin edit loader**

Apply the identical addition in `src/app/admin/listings/[id]/edit/page.tsx` after its `laserIncluded: listing.laserIncluded,` line.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/listings/ListingEditForm.tsx "src/app/seller/listings/[id]/edit/page.tsx" "src/app/admin/listings/[id]/edit/page.tsx"
git commit -m "feat(listings): inventory cost field + prefill in edit forms"
```

---

### Task 5: Show inventory cost to buyers on the listing detail

**Files:**
- Modify: `src/lib/listing-detail.ts:39` (interface) and `:89` (mapping)
- Modify: `src/components/listing-detail/FinancialsGrid.tsx:7-14` (reuse `formatPrice`) and `:82-90` (Inventory list item)

**Interfaces:**
- Consumes: `listings.inventoryCostEstimate` (cents).
- Produces: `ListingDetail.inventoryCostEstimate: number | null`; the detail "Included Assets" Inventory row shows the formatted amount when present.

- [ ] **Step 1: Add to the `ListingDetail` interface**

In `src/lib/listing-detail.ts`, in `interface ListingDetail`, after `otherAssets: string | null`:

```ts
  inventoryIncluded: boolean
  laserIncluded: boolean
  otherAssets: string | null
  inventoryCostEstimate: number | null
```

- [ ] **Step 2: Add to the mapping**

In the returned object of `getListingById`, after `otherAssets: listing.otherAssets ?? null,`:

```ts
    otherAssets: listing.otherAssets ?? null,
    inventoryCostEstimate: listing.inventoryCostEstimate ?? null,
```

- [ ] **Step 3: Render the amount on the Inventory row**

In `src/components/listing-detail/FinancialsGrid.tsx`, replace the `Inventory` list item body (the `<li>` rendered when `listing.inventoryIncluded`) so the line reads the formatted cost when set:

```tsx
            {listing.inventoryIncluded && (
              <li className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 shrink-0">
                  <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                {listing.inventoryCostEstimate != null
                  ? `Inventory (~${formatPrice(listing.inventoryCostEstimate)} value)`
                  : 'Inventory'}
              </li>
            )}
```

(`formatPrice` already exists at the top of this file and returns `-` for null, so the guard keeps the plain "Inventory" label when no cost is set.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/listing-detail.ts src/components/listing-detail/FinancialsGrid.tsx
git commit -m "feat(listings): show inventory cost estimate on listing detail"
```

---

## Phase 2 — Inventory browse filter (query layer)

### Task 6: Add the `inventoryIncluded` filter to `getListings`

**Files:**
- Modify: `src/lib/listings-query.ts:14-27` (`ListingFilters`), `:57` (destructure), `:82-109` (conditions)
- Test: `src/__tests__/listings-query.test.ts` (append one `it`)

**Interfaces:**
- Produces: `ListingFilters.inventoryIncluded?: boolean`; when `true`, results are limited to `listings.inventory_included = true`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("getListings", ...)` block in `src/__tests__/listings-query.test.ts` (after the existing type/state tests):

```ts
  it("applies the inventory filter when inventoryIncluded is true", async () => {
    const rows = [makeRow(0)]
    const chain = makeQueryChain(rows)
    mockSelect.mockReturnValue(chain)

    const result = await getListings({ inventoryIncluded: true })

    expect(result.items).toHaveLength(1)
    expect(chain.where).toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run it to verify it compiles/fails**

Run: `npx vitest run src/__tests__/listings-query.test.ts`
Expected: FAIL — TypeScript error "Object literal may only specify known properties" on `inventoryIncluded` (the field doesn't exist yet).

- [ ] **Step 3: Add the field to `ListingFilters`**

In `src/lib/listings-query.ts`, in `interface ListingFilters`, after `minYearsOpen?: number`:

```ts
  minYearsOpen?: number // minimum years a location has been open
  inventoryIncluded?: boolean // only listings that include inventory
```

- [ ] **Step 4: Destructure and add the condition**

Change the destructure line (~57):

```ts
  const { types, states, minPrice, maxPrice, cursor, query, minYearsOpen, inventoryIncluded } = filters
```

Add to the `conditions` array (after the `minYearsOpen` condition, before the radius gate):

```ts
    inventoryIncluded ? eq(listings.inventoryIncluded, true) : undefined,
```

(`eq` and `listings` are already imported.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/listings-query.test.ts`
Expected: PASS (all tests, including the new one).

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit` (expected: no errors).

```bash
git add src/lib/listings-query.ts src/__tests__/listings-query.test.ts
git commit -m "feat(browse): inventoryIncluded filter in getListings"
```

---

## Phase 3 — Browse bar redesign (UI)

### Task 7: Add a prominent variant to `LocationSearch`

**Files:**
- Modify: `src/components/browse/LocationSearch.tsx:8-12,35` (prop + class)
- Modify: `src/app/globals.css:584` (after the existing `.hs-geocoder` rules)

**Interfaces:**
- Produces: `LocationSearch` accepts `variant?: "default" | "prominent"` (default `"default"`); `"prominent"` adds the `hs-geocoder--lg` class.

- [ ] **Step 1: Add the prop**

In `src/components/browse/LocationSearch.tsx`, update the props and wrapper:

```ts
interface LocationSearchProps {
  onSelect: (location: { lng: number; lat: number; name: string }) => void
  variant?: "default" | "prominent"
}

export function LocationSearch({ onSelect, variant = "default" }: LocationSearchProps) {
```

And change the wrapper div:

```tsx
    <div className={`hs-geocoder${variant === "prominent" ? " hs-geocoder--lg" : ""}`}>
```

- [ ] **Step 2: Add the CSS**

Append to `src/app/globals.css` after the `.hs-geocoder input:focus` rule:

```css
/* Prominent variant used in the top filter bar */
.hs-geocoder--lg input {
  height: 52px;
  border-radius: 9999px;
  font-size: 0.95rem;
}
```

- [ ] **Step 3: Type-check and commit**

Run: `npx tsc --noEmit` (expected: no errors).

```bash
git add src/components/browse/LocationSearch.tsx src/app/globals.css
git commit -m "feat(browse): prominent variant for LocationSearch"
```

---

### Task 8: Rewrite `FilterBar` — prominent search, type dropdown, Filters dropdown, sort right

**Files:**
- Modify (replace contents): `src/components/browse/FilterBar.tsx`

**Interfaces:**
- Consumes: `LocationSearch` (Task 7); `FilterPopover`; `StatePanel`/`PricePanel` (kept in this file).
- Produces: `FilterBar` now takes `{ onLocationSelect: (loc: { lng: number; lat: number; name: string }) => void }`. `useListingFilters` gains `inventoryIncluded: parseAsBoolean.withDefault(false)`. `LayerToggles` remains exported (rendered by `BrowsePage` in Task 9). The standalone top-left text input, the standalone State pill, the standalone Years Open pill, and the inline `<LayerToggles />` are removed from the bar.

- [ ] **Step 1: Replace `src/components/browse/FilterBar.tsx` with the new version**

```tsx
"use client"

import { useState } from "react"
import { parseAsArrayOf, parseAsBoolean, parseAsFloat, parseAsInteger, parseAsString, useQueryStates } from "nuqs"
import { US_STATES } from "@/lib/us-states"
import { FilterPopover } from "./FilterPopover"
import { LocationSearch } from "./LocationSearch"

// Radius range (miles) for the location search slider.
export const RADIUS_MIN_MILES = 1
export const RADIUS_MAX_MILES = 100
export const DEFAULT_RADIUS_MILES = 25

// Bundle is intentionally absent from the filter UI (still valid in the DB).
const LISTING_TYPES = [
  { label: "Suite", value: "suite" },
  { label: "Flagship", value: "flagship" },
  { label: "Territory", value: "territory" },
]

const SORT_OPTIONS = [
  { label: "Newest first", value: "newest" },
  { label: "Price: Low to high", value: "price-asc" },
  { label: "Price: High to low", value: "price-desc" },
  { label: "Nearest first", value: "distance", requiresCenter: true },
]

const TIME_OPEN_OPTIONS = [
  { label: "Any", value: 0 },
  { label: "1+ years", value: 1 },
  { label: "2+ years", value: 2 },
  { label: "3+ years", value: 3 },
  { label: "5+ years", value: 5 },
]

export function useListingFilters() {
  return useQueryStates({
    query: parseAsString.withDefault(""),
    types: parseAsArrayOf(parseAsString).withDefault([]),
    states: parseAsArrayOf(parseAsString).withDefault([]),
    minPrice: parseAsInteger,
    maxPrice: parseAsInteger,
    sort: parseAsString.withDefault("newest"),
    minYearsOpen: parseAsInteger,
    inventoryIncluded: parseAsBoolean.withDefault(false),
    centerLat: parseAsFloat,
    centerLng: parseAsFloat,
    radiusMiles: parseAsInteger,
    centerLabel: parseAsString.withDefault(""),
    showListings: parseAsBoolean.withDefault(true),
    showCompetitors: parseAsBoolean.withDefault(true),
  })
}

// ---- Price helpers (URL stores cents; users enter whole dollars) ----------
function fmtShortPrice(cents: number): string {
  const d = cents / 100
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`
  if (d >= 1_000) return `$${Math.round(d / 1_000)}k`
  return `$${d}`
}
function priceSummary(minCents: number | null, maxCents: number | null): string | null {
  if (minCents != null && maxCents != null) return `${fmtShortPrice(minCents)}–${fmtShortPrice(maxCents)}`
  if (minCents != null) return `${fmtShortPrice(minCents)}+`
  if (maxCents != null) return `≤${fmtShortPrice(maxCents)}`
  return null
}

interface FilterBarProps {
  onLocationSelect: (location: { lng: number; lat: number; name: string }) => void
}

export function FilterBar({ onLocationSelect }: FilterBarProps) {
  const [filters, setFilters] = useListingFilters()

  const hasActiveFilters =
    !!filters.query ||
    filters.types.length > 0 ||
    filters.states.length > 0 ||
    filters.minPrice !== null ||
    filters.maxPrice !== null ||
    (filters.minYearsOpen !== null && filters.minYearsOpen > 0) ||
    filters.inventoryIncluded ||
    filters.centerLat !== null

  function toggleType(value: string) {
    const current = filters.types
    const updated = current.includes(value)
      ? current.filter((t) => t !== value)
      : [...current, value]
    setFilters({ types: updated })
  }

  function toggleState(value: string) {
    const current = filters.states
    const updated = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value]
    setFilters({ states: updated })
  }

  function clearAll() {
    setFilters(
      {
        query: null,
        types: [],
        states: [],
        minPrice: null,
        maxPrice: null,
        sort: "newest",
        minYearsOpen: null,
        inventoryIncluded: false,
        centerLat: null,
        centerLng: null,
        radiusMiles: null,
        centerLabel: null,
      },
      { shallow: false }
    )
  }

  // Count of active filters living inside the "Filters" dropdown.
  const filtersCount =
    (filters.query ? 1 : 0) +
    (filters.states.length > 0 ? 1 : 0) +
    (filters.minYearsOpen && filters.minYearsOpen > 0 ? 1 : 0) +
    (filters.inventoryIncluded ? 1 : 0)

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Prominent geographic search (desktop bar; mobile uses the second-row copy) */}
          <div className="hidden md:block w-[320px] lg:w-[360px]">
            <LocationSearch onSelect={onLocationSelect} variant="prominent" />
          </div>

          <div className="hidden md:block h-7 w-px bg-gray-200" />

          {/* Listing Type — multi-select dropdown */}
          <FilterPopover
            label="Listing Type"
            active={filters.types.length > 0}
            summary={filters.types.length > 0 ? String(filters.types.length) : null}
          >
            {() => (
              <ListingTypePanel
                selected={filters.types}
                onToggle={toggleType}
                onClear={() => setFilters({ types: [] })}
              />
            )}
          </FilterPopover>

          {/* Price — free numeric entry */}
          <FilterPopover
            label="Price"
            active={filters.minPrice !== null || filters.maxPrice !== null}
            summary={priceSummary(filters.minPrice, filters.maxPrice)}
          >
            {(close) => (
              <PricePanel
                minCents={filters.minPrice}
                maxCents={filters.maxPrice}
                onApply={(minCents, maxCents) => setFilters({ minPrice: minCents, maxPrice: maxCents })}
                close={close}
              />
            )}
          </FilterPopover>

          {/* Filters — keyword + state + years open + inventory */}
          <FilterPopover
            label="Filters"
            active={filtersCount > 0}
            summary={filtersCount > 0 ? String(filtersCount) : null}
            panelClassName="w-[300px]"
          >
            {(close) => (
              <FiltersPanel
                query={filters.query}
                states={filters.states}
                minYearsOpen={filters.minYearsOpen}
                inventoryIncluded={filters.inventoryIncluded}
                onQueryChange={(v) => setFilters({ query: v || null })}
                onToggleState={toggleState}
                onClearStates={() => setFilters({ states: [] })}
                onYearsChange={(v) => setFilters({ minYearsOpen: v || null })}
                onInventoryChange={(v) => setFilters({ inventoryIncluded: v })}
                onClearAll={() =>
                  setFilters({ query: null, states: [], minYearsOpen: null, inventoryIncluded: false })
                }
                close={close}
              />
            )}
          </FilterPopover>

          {/* Spacer pushes Sort to the right */}
          <div className="flex-1" />

          {/* Sort */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">Sort</span>
            <div className="relative">
              <select
                aria-label="Sort listings"
                value={filters.sort}
                onChange={(e) => setFilters({ sort: e.target.value })}
                className="
                  h-11 appearance-none rounded-full border border-gray-300 bg-white pl-4 pr-9 text-sm font-medium text-gray-700
                  transition-all duration-200 ease-out hover:border-gray-400
                  focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500
                "
              >
                {SORT_OPTIONS.filter((o) => !o.requiresCenter || filters.centerLat !== null).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>

          {/* Clear all */}
          <button
            onClick={clearAll}
            className={`
              text-sm font-semibold text-hs-red-600 hover:text-hs-red-700
              px-3 py-2 rounded-lg transition-all duration-200 ease-out hover:bg-hs-red-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
              ${hasActiveFilters ? "opacity-100 translate-x-0" : "opacity-0 translate-x-2 pointer-events-none"}
            `}
            tabIndex={hasActiveFilters ? 0 : -1}
            aria-hidden={!hasActiveFilters}
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Listing Type multi-select panel --------------------------------------
function ListingTypePanel({
  selected, onToggle, onClear,
}: {
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  return (
    <div className="min-w-[200px]">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Listing type</h4>
      {LISTING_TYPES.map((t) => {
        const checked = selected.includes(t.value)
        return (
          <label
            key={t.value}
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm"
          >
            <input type="checkbox" checked={checked} onChange={() => onToggle(t.value)} className="w-4 h-4 accent-hs-red-600" />
            {t.label}
          </label>
        )
      })}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <button type="button" onClick={onClear} className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700">
          Clear
        </button>
        <span className="text-xs text-gray-400 tabular-nums">{selected.length} selected</span>
      </div>
    </div>
  )
}

// ---- Filters dropdown panel (keyword + state + years + inventory) ----------
function FiltersPanel({
  query, states, minYearsOpen, inventoryIncluded,
  onQueryChange, onToggleState, onClearStates, onYearsChange, onInventoryChange, onClearAll, close,
}: {
  query: string
  states: string[]
  minYearsOpen: number | null
  inventoryIncluded: boolean
  onQueryChange: (v: string) => void
  onToggleState: (value: string) => void
  onClearStates: () => void
  onYearsChange: (v: number) => void
  onInventoryChange: (v: boolean) => void
  onClearAll: () => void
  close: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Keyword */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Keyword</h4>
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Salon name, city, notes…"
          className="w-full h-9 rounded-lg border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
        />
      </div>

      {/* State */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">State</h4>
        <StatePanel selected={states} onToggle={onToggleState} onClear={onClearStates} />
      </div>

      {/* Years open */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Minimum years open</h4>
        {TIME_OPEN_OPTIONS.map((o) => {
          const checked = (minYearsOpen ?? 0) === o.value
          return (
            <label key={o.value} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
              <input
                type="radio"
                name="years-open"
                checked={checked}
                onChange={() => onYearsChange(o.value)}
                className="w-4 h-4 accent-hs-red-600"
              />
              {o.label}
            </label>
          )
        })}
      </div>

      {/* Inventory */}
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Inventory</h4>
        <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={inventoryIncluded}
            onChange={(e) => onInventoryChange(e.target.checked)}
            className="w-4 h-4 accent-hs-red-600"
          />
          Inventory included only
        </label>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <button type="button" onClick={onClearAll} className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700">
          Clear
        </button>
        <button
          type="button"
          onClick={close}
          className="px-3.5 py-1.5 rounded-lg bg-hs-red-600 text-white text-xs font-semibold hover:bg-hs-red-700"
        >
          Done
        </button>
      </div>
    </div>
  )
}

// ---- State dropdown panel (unchanged) -------------------------------------
function StatePanel({
  selected, onToggle, onClear,
}: {
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  const [q, setQ] = useState("")
  const filtered = US_STATES.filter((s) => s.label.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="w-full">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search states…"
        className="w-full h-9 rounded-lg border border-gray-300 px-3 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
      />
      <div className="max-h-[200px] overflow-y-auto grid grid-cols-2 gap-0.5 pr-0.5">
        {filtered.map((s) => {
          const checked = selected.includes(s.value)
          return (
            <label key={s.value} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
              <input type="checkbox" checked={checked} onChange={() => onToggle(s.value)} className="w-4 h-4 accent-hs-red-600 shrink-0" />
              <span className="truncate">{s.label}</span>
            </label>
          )
        })}
        {filtered.length === 0 && (
          <p className="col-span-2 text-sm text-gray-400 px-2 py-3 text-center">No matches</p>
        )}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <button type="button" onClick={onClear} className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700">
          Clear
        </button>
        <span className="text-xs text-gray-400 tabular-nums">{selected.length} selected</span>
      </div>
    </div>
  )
}

// ---- Price entry panel (unchanged) ----------------------------------------
function PricePanel({
  minCents, maxCents, onApply, close,
}: {
  minCents: number | null
  maxCents: number | null
  onApply: (minCents: number | null, maxCents: number | null) => void
  close: () => void
}) {
  const [min, setMin] = useState(minCents != null ? String(Math.round(minCents / 100)) : "")
  const [max, setMax] = useState(maxCents != null ? String(Math.round(maxCents / 100)) : "")

  const toCents = (v: string) => {
    const digits = v.replace(/[^0-9]/g, "")
    return digits ? Number(digits) * 100 : null
  }
  const apply = () => {
    onApply(toCents(min), toCents(max))
    close()
  }
  const clear = () => {
    setMin("")
    setMax("")
    onApply(null, null)
    close()
  }

  return (
    <div className="min-w-[260px]">
      <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2.5">Price range</h4>
      <div className="flex items-center gap-2">
        <PriceInput value={min} onChange={setMin} placeholder="Min" onEnter={apply} />
        <span className="text-gray-400">–</span>
        <PriceInput value={max} onChange={setMax} placeholder="Max" onEnter={apply} />
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        <button type="button" onClick={clear} className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700">
          Clear
        </button>
        <button type="button" onClick={apply} className="px-3.5 py-1.5 rounded-lg bg-hs-red-600 text-white text-xs font-semibold hover:bg-hs-red-700">
          Apply
        </button>
      </div>
    </div>
  )
}

function PriceInput({
  value, onChange, placeholder, onEnter,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onEnter: () => void
}) {
  const display = value ? Number(value).toLocaleString("en-US") : ""
  return (
    <div className="relative flex-1">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
      <input
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => { if (e.key === "Enter") onEnter() }}
        placeholder={placeholder}
        className="w-full h-10 rounded-lg border border-gray-300 pl-6 pr-2 text-sm text-gray-800 tabular-nums focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
      />
    </div>
  )
}

// ---- Map-layer toggles (Hello Sugar / Competitors) — now rendered by BrowsePage
export function LayerToggles() {
  const [filters, setFilters] = useListingFilters()
  return (
    <div className="flex items-center gap-1.5">
      <LayerChip
        label="Hello Sugar"
        color="#db2777"
        active={filters.showListings}
        onClick={() => setFilters({ showListings: !filters.showListings })}
      />
      <LayerChip
        label="Competitors"
        color="#B9772E"
        diamond
        active={filters.showCompetitors}
        onClick={() => setFilters({ showCompetitors: !filters.showCompetitors })}
      />
    </div>
  )
}

function LayerChip({
  label, color, active, onClick, diamond = false,
}: {
  label: string; color: string; active: boolean; onClick: () => void; diamond?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`
        inline-flex items-center gap-2 h-11 px-3 rounded-full text-sm font-medium border
        transition-all duration-200 ease-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-1
        ${active
          ? "bg-white border-gray-300 text-gray-800 hover:bg-gray-50"
          : "bg-gray-100 border-gray-200 text-gray-400 hover:bg-gray-200"}
      `}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-3 w-3 border border-white ${diamond ? "rotate-45 rounded-[2px]" : "rounded-full"}`}
        style={{ backgroundColor: active ? color : "#9ca3af" }}
      />
      {label}
    </button>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `BrowsePage.tsx`/`MobileFilterDrawer.tsx` (they render `<FilterBar />` without the new required `onLocationSelect` prop). Those are fixed in Task 9. No errors within `FilterBar.tsx` itself.

- [ ] **Step 3: Commit**

```bash
git add src/components/browse/FilterBar.tsx
git commit -m "feat(browse): redesign FilterBar — prominent search, type + Filters dropdowns, sort right"
```

---

### Task 9: Wire `BrowsePage` and `MobileFilterDrawer` to the new bar

**Files:**
- Modify: `src/components/browse/BrowsePage.tsx:172` (FilterBar prop), `:259-263` (second-row location search → mobile-only), add `<LayerToggles />` to the second row, `:407` (drawer prop), and the `filters`/`SaveSearchButton` objects (`:77-88`, `:311-327`)
- Modify: `src/components/browse/MobileFilterDrawer.tsx:6-11,63` (forward `onLocationSelect`)

**Interfaces:**
- Consumes: `FilterBar` (requires `onLocationSelect`), `LayerToggles` (Task 8), `handleLocationSelect` (exists).
- Produces: desktop bar shows the prominent search; mobile keeps the second-row search (`md:hidden`); `LayerToggles` render on the second row; `filters.inventoryIncluded` flows to `ListingGrid` and the save payload.

- [ ] **Step 1: Import `LayerToggles` and pass the prop to `FilterBar`**

In `src/components/browse/BrowsePage.tsx`, update the FilterBar import and the desktop render:

```ts
import { FilterBar, LayerToggles, useListingFilters, RADIUS_MIN_MILES, RADIUS_MAX_MILES, DEFAULT_RADIUS_MILES } from "./FilterBar"
```

```tsx
      {/* Filter bar — desktop only, sticky at top */}
      <div className="hidden md:block">
        <FilterBar onLocationSelect={handleLocationSelect} />
      </div>
```

- [ ] **Step 2: Thread `inventoryIncluded` into the derived `filters` object**

In the `filters` object (around line 77), after `minYearsOpen`:

```ts
    minYearsOpen: rawFilters.minYearsOpen ?? undefined,
    inventoryIncluded: rawFilters.inventoryIncluded || undefined,
```

- [ ] **Step 3: Make the second-row location search mobile-only and add layer toggles**

Replace the second-row controls block so the geographic search only renders on mobile and the layer toggles appear on the row. Specifically:

a) Change the `LocationSearch` wrapper (around line 261) to be mobile-only:

```tsx
            <div className="max-w-sm flex-1 md:hidden">
              <LocationSearch onSelect={handleLocationSelect} />
            </div>
```

b) Add `<LayerToggles />` next to the view toggles. Immediately after the closing `</div>` of the List/Map view-toggle group (the `flex rounded-lg border…` block, ~line 231) insert:

```tsx
          {/* Map-layer visibility (moved off the top bar) */}
          <div className="hidden md:flex">
            <LayerToggles />
          </div>
```

(The radius slider + clear-location chip block and `SaveSearchButton` stay exactly as they are.)

- [ ] **Step 4: Add `inventoryIncluded` to the save payload**

In the `SaveSearchButton` `filters` prop (around line 312), after `minYearsOpen: rawFilters.minYearsOpen,`:

```ts
                minYearsOpen: rawFilters.minYearsOpen,
                inventoryIncluded: rawFilters.inventoryIncluded,
```

- [ ] **Step 5: Pass `onLocationSelect` to the mobile drawer**

Update the drawer render at the bottom of `BrowsePage`:

```tsx
      {/* Mobile filter drawer */}
      <MobileFilterDrawer
        isOpen={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        onLocationSelect={handleLocationSelect}
      />
```

- [ ] **Step 6: Forward the prop in `MobileFilterDrawer`**

In `src/components/browse/MobileFilterDrawer.tsx`, update the props and the `FilterBar` render:

```ts
interface MobileFilterDrawerProps {
  isOpen: boolean
  onClose: () => void
  onLocationSelect: (location: { lng: number; lat: number; name: string }) => void
}

export function MobileFilterDrawer({ isOpen, onClose, onLocationSelect }: MobileFilterDrawerProps) {
```

```tsx
        <div className="p-4">
          <FilterBar onLocationSelect={onLocationSelect} />
        </div>
```

(The prominent search inside `FilterBar` is `hidden md:block`, so it stays hidden in the mobile drawer — mobile users use the second-row search. The drawer's `FilterBar` still exposes the Listing Type, Price, and Filters dropdowns.)

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere.

- [ ] **Step 8: Visual check (only if a dev server is already running)**

On desktop `/browse`: prominent search top-left; Listing Type / Price / Filters dropdowns; Sort on the right; layer chips on the second row; Bundle absent from Listing Type. Open Filters → keyword, state, years, inventory. On a narrow viewport: the second-row search shows; the "Filters" button opens the drawer with the dropdowns.

- [ ] **Step 9: Commit**

```bash
git add src/components/browse/BrowsePage.tsx src/components/browse/MobileFilterDrawer.tsx
git commit -m "feat(browse): wire redesigned bar — prominent search, layer toggles, inventory filter"
```

---

## Phase 4 — Saved-search & alert parity for the inventory filter

### Task 10: Persist and re-apply `inventoryIncluded` in saved searches

**Files:**
- Modify: `src/db/schema/alerts.ts:17` (column)
- Modify: `src/lib/alert-actions.ts:34` (alertSchema), `:57` (toRow), `:127` (updateAlert patch)
- Modify: `src/lib/saved-search.ts:3-7` (SavedSearchFields), `:39` (describe), `:56` (browse params)
- Modify: `src/components/browse/SaveSearchButton.tsx:7-21` (input), `:31-38` (hasAnyFilter), `:53` (createAlert call)

**Interfaces:**
- Produces: `alerts.inventoryIncluded` (boolean, default false); `SaveSearchInput.inventoryIncluded?: boolean`; saved searches describe/re-apply the inventory filter (`inventoryIncluded=true` in the browse query string).

- [ ] **Step 1: Add the column**

In `src/db/schema/alerts.ts`, after `minYearsOpen: integer("min_years_open"),`:

```ts
  minYearsOpen: integer("min_years_open"),
  inventoryIncluded: boolean("inventory_included").default(false).notNull(),
```

(`boolean` is already imported.)

- [ ] **Step 2: Push the schema**

Run: `npm run db:push`
Expected: drizzle adds `inventory_included` to `alerts` (default false), no data loss.

- [ ] **Step 3: Extend `alert-actions`**

In `src/lib/alert-actions.ts`, add to `alertSchema` (after `minYearsOpen`):

```ts
  minYearsOpen: z.number().int().nonnegative().optional().nullable(),
  inventoryIncluded: z.boolean().optional(),
```

In `toRow`, after `minYearsOpen: data.minYearsOpen ?? null,`:

```ts
    minYearsOpen: data.minYearsOpen ?? null,
    inventoryIncluded: data.inventoryIncluded ?? false,
```

In `updateAlert`'s patch block, after the `minYearsOpen` line:

```ts
  if ("minYearsOpen" in d) patch.minYearsOpen = d.minYearsOpen ?? null
  if ("inventoryIncluded" in d) patch.inventoryIncluded = d.inventoryIncluded ?? false
```

- [ ] **Step 4: Extend `saved-search.ts` (describe + re-apply)**

In `src/lib/saved-search.ts`, add `"inventoryIncluded"` to the `SavedSearchFields` Pick:

```ts
export type SavedSearchFields = Pick<
  Alert,
  | "query" | "states" | "listingTypes" | "minPrice" | "maxPrice"
  | "minYearsOpen" | "inventoryIncluded" | "sort" | "centerLat" | "centerLng" | "radiusMiles" | "centerLabel"
>
```

In `describeSavedSearch`, after the `minYearsOpen` push:

```ts
  if (a.minYearsOpen && a.minYearsOpen > 0) parts.push(`${a.minYearsOpen}+ yrs open`)
  if (a.inventoryIncluded) parts.push("inventory included")
```

In `savedSearchToBrowseParams`, after the `minYearsOpen` set:

```ts
  if (a.minYearsOpen != null) p.set("minYearsOpen", String(a.minYearsOpen))
  if (a.inventoryIncluded) p.set("inventoryIncluded", "true")
```

- [ ] **Step 5: Extend `SaveSearchButton`**

In `src/components/browse/SaveSearchButton.tsx`, add to `SaveSearchInput` (after `minYearsOpen`):

```ts
  minYearsOpen?: number | null
  inventoryIncluded?: boolean
```

Add to `hasAnyFilter`:

```ts
    (filters.minYearsOpen != null && filters.minYearsOpen > 0) ||
    filters.inventoryIncluded === true ||
    (filters.centerLat != null && filters.centerLng != null && filters.radiusMiles != null)
```

Add to the `createAlert` call (after `minYearsOpen`):

```ts
      minYearsOpen: filters.minYearsOpen ?? undefined,
      inventoryIncluded: filters.inventoryIncluded || undefined,
```

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit` (expected: no errors).

```bash
git add src/db/schema/alerts.ts src/lib/alert-actions.ts src/lib/saved-search.ts src/components/browse/SaveSearchButton.tsx
git commit -m "feat(alerts): persist & re-apply inventoryIncluded in saved searches"
```

---

### Task 11: Match the inventory filter in alert emails

**Files:**
- Modify: `src/lib/alert-match.ts:4-22` (criteria + input), `:46-52` (matching)
- Modify: `src/lib/alert-actions.ts:190-198` (`MatchListing` type), `:218-224`-region call is in admin actions — see next file
- Modify: `src/lib/admin/actions.ts:109-114` (pass `inventoryIncluded`)
- Test: `src/__tests__/alert-match.test.ts:6-18` (extend fixtures) and after `:52` (new cases)

**Interfaces:**
- Consumes: `alerts.inventoryIncluded` (Task 10), `listing.inventoryIncluded`.
- Produces: `AlertMatchCriteria` and `MatchListingInput` gain `inventoryIncluded`; an alert with `inventoryIncluded: true` only matches listings that include inventory.

- [ ] **Step 1: Write the failing test**

In `src/__tests__/alert-match.test.ts`, add `inventoryIncluded: false,` to the `baseAlert` object and `inventoryIncluded: false` to the `listing` object, then add these cases before the closing `})` of the describe:

```ts
  it("matches any listing when the alert does not require inventory", () => {
    expect(listingMatchesAlert(baseAlert, { ...listing, inventoryIncluded: false }, [], NOW)).toBe(true)
  })
  it("requires inventory when the alert sets inventoryIncluded", () => {
    const alert = { ...baseAlert, inventoryIncluded: true }
    expect(listingMatchesAlert(alert, { ...listing, inventoryIncluded: false }, [], NOW)).toBe(false)
    expect(listingMatchesAlert(alert, { ...listing, inventoryIncluded: true }, [], NOW)).toBe(true)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/__tests__/alert-match.test.ts`
Expected: FAIL — TS errors (`inventoryIncluded` not on the types) and/or assertion failures.

- [ ] **Step 3: Extend the types and matching logic**

In `src/lib/alert-match.ts`, extend `AlertMatchCriteria` with `inventoryIncluded` as an **optional** field (intersection, not added to the Pick — this keeps existing `alert-actions.test.ts` alert fixtures, which omit it, compiling under `tsc`):

```ts
export type AlertMatchCriteria = Pick<
  Alert,
  | "notifyEnabled" | "includeListings" | "states" | "listingTypes"
  | "minPrice" | "maxPrice" | "minYearsOpen" | "centerLat" | "centerLng" | "radiusMiles"
> & { inventoryIncluded?: boolean | null }
```

Add the field to `MatchListingInput` as **optional** (so existing `triggerAlertMatching` test calls that omit it still type-check; undefined is treated as "no inventory"):

```ts
export interface MatchListingInput {
  type: string
  state: string | null
  askingPrice: number | null
  inventoryIncluded?: boolean
}
```

Add the check inside `listingMatchesAlert` (after the price checks, before `minYearsOpen`):

```ts
  if (alert.inventoryIncluded === true && listing.inventoryIncluded !== true) return false
```

- [ ] **Step 4: Pass the field from the approval trigger**

In `src/lib/alert-actions.ts`, add `inventoryIncluded?: boolean` (optional) to the local `MatchListing` type:

```ts
type MatchListing = {
  id: string
  type: string
  city: string | null
  state: string | null
  askingPrice: number | null
  inventoryIncluded?: boolean
  locationName: string | null
  locations?: MatchLocation[]
}
```

In `src/lib/admin/actions.ts`, add to the `triggerAlertMatching({ ... })` call (after `askingPrice: listing.askingPrice,`):

```ts
    askingPrice: listing.askingPrice,
    inventoryIncluded: listing.inventoryIncluded,
```

(`listing` here is the full `listings` row selected earlier in the approve action, so `inventoryIncluded` is present.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/alert-match.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite + type-check**

Run: `npm test` (expected: all green — `alert-actions.test.ts` fixtures omit `inventoryIncluded`; because both the criteria and listing fields are optional and the matching check treats missing as "no inventory," those tests pass unchanged).
Run: `npx tsc --noEmit` (expected: no errors — the optional fields in Step 3/4 mean no existing test fixture needs editing).

- [ ] **Step 7: Commit**

```bash
git add src/lib/alert-match.ts src/lib/alert-actions.ts src/lib/admin/actions.ts src/__tests__/alert-match.test.ts
git commit -m "feat(alerts): match inventoryIncluded filter on listing approval"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Manual smoke (only if a dev server is already running — do not start one unprompted)**

1. `/browse` desktop: prominent location search filters by radius; Listing Type dropdown (no Bundle) filters; Price pill works; Filters dropdown applies keyword/state/years/inventory; Sort sits on the right; layer chips on the second row toggle map layers.
2. Pre-existing Bundle listings still appear when no type filter is set.
3. `/listings/new` step 3: inventory cost field appears only when "Inventory" is checked; submit; the new listing's detail page shows "Inventory (~$X value)".
4. Save a search with the inventory filter on → it appears in My Alerts described as "inventory included" and re-applies on click.

---

## Self-review notes (addressed)

- **Spec coverage:** (1) prominent location search → Tasks 7–9; (2) keyword relocated into Filters → Task 8; (3) listing-type multi-select w/o Bundle → Task 8; (4) Filters dropdown (keyword/state/years/inventory) → Task 8; (5) inventory cost field, buyer-visible → Tasks 1–5; (6) inventory filter → Tasks 6, 8–11; (7) sort on the right → Task 8. State folded into Filters, Price standalone → Task 8. Mobile parity → Task 9. Saved-search + alert parity → Tasks 10–11.
- **Bundle preserved:** enum, existing rows, and `saveDraft` auto-derivation untouched; the full enum cast in `getListings` and `bundle` label in `saved-search.ts` remain.
- **Edge case (uncheck clears cost):** handled in Task 2 (`null` when not included) and the conditional inputs in Tasks 3–4.
