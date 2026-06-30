# Marketplace Browse Bar Redesign — Design

**Date:** 2026-06-30
**Status:** Approved design, pending implementation plan
**Mockup:** https://claude.ai/code/artifact/08853a1b-8625-45b7-8a79-a2dde341bde2

## Goal

Restructure the `/browse` filter bar so the geographic search is the single
prominent search, listing-type selection collapses into one dropdown, secondary
filters consolidate under a Zillow-style "Filters" dropdown, and sort moves to
the right. Add an inventory-cost field to the listing intake form and an
inventory filter to browse.

## Summary of changes

1. **Promote the geographic search.** Move the MapTiler `LocationSearch` from
   the second row into the top-left of the filter bar, enlarged and prominent.
   It remains the geographic (lat/lng + radius) search.
2. **Relocate the keyword search.** The old top-left text input (the `query`
   param: salon name / city / notes) moves into the new Filters dropdown.
3. **Listing Type → one multi-select dropdown** (checkboxes) replacing the
   Suite/Flagship/Territory/Bundle pills. **Bundle is removed from the filter
   options only** — the `bundle` enum value, existing bundle listings, and
   bundle creation on the intake form all remain.
4. **New "Filters" dropdown** holding: Keyword, State (multi-select), Years
   Open, and a new Inventory-included toggle.
5. **Price stays as its own pill** on the bar (next to Listing Type).
6. **Intake form:** add an "estimated inventory cost" field shown when
   "Inventory included" is checked; buyer-visible on the listing detail page.
7. **Sort moves to the far right** of the bar (already positioned there via the
   flex spacer; preserved in the new layout).

## Final bar layout

```
[ 🔍 Search by city, state, or zip ] | [Listing Type ▾] [Price ▾] [≡ Filters ▾] ……… Sort [Newest first ▾]
```

Second row (unchanged except the geographic search box is removed): List/Map
toggle, Listings/Competitors toggle, Hello Sugar / Competitors layer chips, and
Save this search. The radius slider + active-location chip still appear on this
row once a location is selected.

## Architecture & affected units

### Browse filter UI

- **`src/components/browse/FilterBar.tsx`** — primary changes:
  - Remove the top-left `query` text input.
  - Render the promoted `LocationSearch` in the top-left slot (taller/wider).
    `FilterBar` gains an `onLocationSelect` prop; `BrowsePage` passes its
    existing `handleLocationSelect`.
  - Replace the `LISTING_TYPES` pill row with a `FilterPopover` containing a
    multi-select checkbox panel. The options list drops `bundle`
    (`{suite, flagship, territory}`); the existing `types` URL param and
    `toggleType` logic are reused unchanged.
  - Remove the standalone `State` `FilterPopover`.
  - Keep the `Price` `FilterPopover` as-is.
  - Add a new `Filters` `FilterPopover` (styled like Zillow's, dark-outlined)
    whose panel contains, top to bottom: a Keyword input bound to `query`, the
    existing `StatePanel` (state multi-select), the Years-Open radio group, and
    an "Inventory included only" checkbox bound to the new `inventoryIncluded`
    param. Footer with Clear/Apply.
  - Keep `Sort` on the right after the flex spacer.
  - `hasActiveFilters` / `clearAll` extended to include `inventoryIncluded`.
- **`src/components/browse/FilterPopover.tsx`** — reused as-is for the Listing
  Type and Filters dropdowns. The Filters trigger shows a count badge of active
  contained filters (keyword, states, years, inventory).
- **`src/components/browse/BrowsePage.tsx`**:
  - Pass `onLocationSelect={handleLocationSelect}` to `FilterBar`.
  - Remove the `LocationSearch` block from the second row; keep the radius
    slider, clear-location chip, view toggles, layer toggles, and Save button.
  - Thread `inventoryIncluded` through the `filters` object passed to
    `ListingGrid` and `SaveSearchButton`.
- **`src/components/browse/MobileFilterDrawer.tsx`** — mirror the changes for
  parity: listing type without Bundle, the inventory toggle, and the keyword
  field. (Mobile uses the drawer, not `FilterBar`.)

### Filter state & query

- **`useListingFilters` (FilterBar.tsx)** — add
  `inventoryIncluded: parseAsBoolean.withDefault(false)`.
- **`src/lib/listings-query.ts`**:
  - Add `inventoryIncluded?: boolean` to `ListingFilters`.
  - Add condition: when true, `eq(listings.inventoryIncluded, true)`.
  - No change to the existing `bundle` handling in the `types` `inArray` — the
    enum cast stays `('suite' | 'flagship' | 'territory' | 'bundle')[]` so any
    persisted bundle filters (e.g. an old saved search) still resolve.

### Inventory cost (intake form → DB → listing detail)

- **DB — `src/db/schema/listings.ts`**: add
  `inventoryCostEstimate: integer("inventory_cost_estimate")` (nullable, cents,
  matching `askingPrice`/`ttmProfit` conventions). Applied via `drizzle-kit
  push` (Neon is push-managed — see project memory).
- **Types — `src/lib/listings/types.ts`**: add
  `inventoryCostEstimate?: number` to `ListingFormData`.
- **Zod — `src/lib/listings/schemas.ts`**: add `inventoryCostEstimate` to
  `photosDetailsSchema` as an optional non-negative number.
- **Form — `src/components/listings/steps/PhotosDetailsStep.tsx`**: add a
  currency input directly after the `inventoryIncluded` checkbox (line ~66),
  rendered only when `inventoryIncluded` is checked. Label: "Estimated value of
  inventory included (optional)", `$`-prefixed numeric input, stored as cents.
- **Create/edit server actions**: map `inventoryCostEstimate` on insert/update;
  prefill it in the edit form. (Locate exact action in the plan phase.)
- **Listing detail page** (`src/app/listings/[id]/…`): in the
  included-assets/inventory display, when inventory is included and a cost is
  set, show e.g. "~$25,000 in inventory included". Buyer-visible.

### Saved search parity

`inventoryIncluded` is added to the saved-search filter payload
(`SaveSearchButton` props and the saved-search schema/storage) and to the alert
matching logic, so a saved search with the inventory filter behaves
consistently. (Exact files pinned in the plan phase.)

## Data flow

URL search params (nuqs) remain the single source of truth for browse filters.
`FilterBar` reads/writes them via `useListingFilters`; `BrowsePage` derives the
`ListingFilters` object and passes it to `ListingGrid`, which calls the
`getListings` server action. Promoting the location search does not change the
geographic data flow — it still writes `centerLat/centerLng/centerLabel/
radiusMiles` and triggers a non-shallow refetch.

## Error handling & edge cases

- **Bundle compatibility:** removing Bundle from the filter UI must not hide
  existing bundle listings (no type filter = all types shown) and must not break
  a persisted saved search that includes `bundle`. The query keeps the full enum
  cast.
- **Inventory cost only when included:** the cost field is conditional on the
  `inventoryIncluded` checkbox. If a user enters a cost then unchecks inventory,
  the saved cost should be cleared (or ignored on submit) so we don't persist a
  cost for a listing that doesn't include inventory.
- **Inventory filter with no results:** behaves like any other filter — empty
  state shown by `ListingGrid`.
- **Bad URL state:** `parseAsBoolean` defaults to `false`; invalid values are
  ignored, consistent with existing param handling.

## Testing

- Unit test `getListings`: `inventoryIncluded: true` returns only listings with
  `inventory_included = true`; `false`/absent returns all.
- Unit test the form/zod schema accepts an optional non-negative
  `inventoryCostEstimate` and rejects negatives.
- Manual/visual check of the new bar against the mockup (desktop) and the mobile
  drawer.
- Per project memory: stop the dev server before `next build` on this Windows
  machine; use `tsc` for per-step type gates (lint is pre-existing broken).

## Out of scope

- No change to map rendering, competitor data, or the radius/Haversine logic.
- No redesign of the listing card grid or the listing detail page beyond adding
  the inventory-cost line.
- No change to how `bundle` listings are created or displayed.
