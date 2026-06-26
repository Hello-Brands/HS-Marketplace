# Save Competitors + List/Map Layer Controls — Design

**Date:** 2026-06-26
**Status:** Approved (pending spec review)

## Summary

Add three related capabilities to the `/browse` experience:

1. Let a user **save competitor locations** (scraper-sourced closures) to their account, surfaced in a new section on the existing Saved page.
2. Add a **show/hide toggle for Hello Sugar listing pins** on the map (top-left), mirroring the existing competitor-closures toggle (top-right). Both layers are independent and can show simultaneously.
3. Add a **two-state segmented switch** (`Listings | Competitors`) controlling what the **left-hand list panel** shows. The map always shows both layers; only the list content switches.

## Background

- **Listings** live in the app-owned `listings` table. Favoriting a listing is done via the `favorites` table, which has a hard foreign key to `listings.id`.
- **Competitors** are scraper-owned closures in the read-only `competitor_opportunities` table, keyed by `googlePlaceId`. They are surfaced by `src/lib/competitor-query.ts` as `CompetitorClosure` objects. They are NOT listings and have no row in `listings`.
- Because the scraper re-baselines/reconciles `competitor_opportunities` (a known behavior of this DB), competitor rows can disappear or change.
- The `/browse` page (`src/components/browse/BrowsePage.tsx`) already has a `List | Map` segmented toggle and a top-right map pill toggling the competitor-closure pin layer. `MapView.tsx` renders HS listing pins (always) plus a second, visually distinct competitor pin layer with click-to-open popups built by `competitorPopupHtml`.

## Decisions (from brainstorming)

- **Saved competitors storage/display:** a new dedicated DB table; surfaced as a **new section on the existing `/account/favorites` page** (not a separate page, not interleaved with listings).
- **Save affordance:** appears in **both** the map pin popup **and** the left-list competitor rows.
- **List switch:** **two-state** — `Listings | Competitors`. The left list shows EITHER HS listings OR competitor locations. The map always shows both layers.
- **Map HS-listings toggle:** a show/hide pill in the **top-left** of the map, mirroring the top-right competitor pill.

## Out of scope (YAGNI)

- No background syncing/refreshing of saved competitor snapshots when scraper data changes.
- No save/favorite affordance on the listing browse cards (listing favoriting stays on the listing detail page as it is today).
- No editing of saved competitor records.

## Architecture

### 1. Data model — `saved_competitors`

New table in a new schema file `src/db/schema/savedCompetitors.ts`:

| Column          | Type      | Notes                                                        |
|-----------------|-----------|--------------------------------------------------------------|
| `id`            | text PK   | `crypto.randomUUID()` default (matches `favorites`)          |
| `userId`        | text      | FK → `users.id`, `onDelete: cascade`                         |
| `placeId`       | text      | Google place id — the stable competitor key                  |
| `brandName`     | text      | snapshot                                                     |
| `address`       | text      | snapshot                                                     |
| `city`          | text      | snapshot                                                     |
| `state`         | text      | snapshot                                                     |
| `lat`           | numeric   | snapshot                                                     |
| `lng`           | numeric   | snapshot                                                     |
| `businessStatus`| text      | snapshot (`CLOSED_PERMANENTLY` / `CLOSED_TEMPORARILY`)       |
| `mapsUrl`       | text null | snapshot                                                     |
| `createdAt`     | timestamp | `defaultNow()`                                               |

Constraints/indexes:
- `uniqueIndex("saved_competitors_user_place_idx").on(userId, placeId)` — one save per user per competitor; also the dedupe/lookup key.

**Snapshot rationale:** No FK to `competitor_opportunities`. That table is scraper-owned and reconciled; a cascading FK would delete a user's saves whenever the scraper churns. Storing the display fields as a snapshot keeps saves stable and renderable even if the source row disappears. Numeric `lat`/`lng` follow the existing convention (driver returns numerics as strings; coerce with `Number(...)` on read).

Drizzle relations: `savedCompetitors.userId → users` (one). No competitor relation.

Export types `SavedCompetitor` / `NewSavedCompetitor` via `$inferSelect` / `$inferInsert`.

### 2. Server actions — `src/lib/saved-competitors-actions.ts`

`'use server'` module mirroring `src/lib/favorites-actions.ts`.

```ts
interface SavedCompetitorInput {
  placeId: string
  brandName: string
  address: string
  city: string
  state: string
  lat: number
  lng: number
  businessStatus: string
  mapsUrl: string | null
}

// Upsert/delete by (userId, placeId). Auth-guarded (throws if unauthenticated).
export async function toggleSavedCompetitor(
  input: SavedCompetitorInput
): Promise<{ saved: boolean }>

// For hydrating initial UI state on /browse.
export async function getSavedCompetitorPlaceIds(): Promise<string[]>
```

- `toggleSavedCompetitor`: look up existing by `userId + placeId`; if present, delete and return `{ saved: false }`; else insert the snapshot and return `{ saved: true }`. Auth via `auth()` (throws `Not authenticated` like `toggleFavorite`).
- `getSavedCompetitorPlaceIds`: returns `[]` when unauthenticated; otherwise the user's saved `placeId`s.
- A separate read used by the Saved page fetches full snapshot rows (can be a query in the page itself, matching how `favorites` page queries directly).

### 3. Browse page data flow

- `src/app/browse/page.tsx` (`BrowseContent`): add `getSavedCompetitorPlaceIds()` to the existing `Promise.all`, and pass `savedCompetitorIds` to `<BrowsePage>`.
- `BrowsePage` props gain `savedCompetitorIds?: string[]` (default `[]`).
- `BrowsePage` state:
  - `listMode: "listings" | "competitors"` (default `"listings"`).
  - `showListings: boolean` (default `true`) — drives the new map HS-listings layer toggle.
  - `savedCompetitorIds` held in a `Set`-backed state hydrated from the prop, updated optimistically on save/unsave so both the list rows and the map popup reflect the current saved state within the session.

### 4. UI components

**`BrowsePage.tsx`:**
- **List switch:** a new segmented `Listings | Competitors` control styled to match the existing `List | Map` toggle (same border/rounded/active classes, `aria-pressed`). Placed in the controls row. Only rendered/meaningful when there is at least one competitor closure; when no competitors exist it can be hidden or disabled (hide to avoid an empty switch).
- In **map view**, the left list panel renders `ListingGrid` when `listMode === "listings"`, else the new `CompetitorList`.
- In **list view** (full-width), same switch applies: listings grid vs. competitor list.
- **Map HS-listings toggle:** a top-left pill on the map (`absolute top-3 left-3`), mirroring the competitor pill's styling, bound to `showListings`. Pass `showListings` into `MapView`.

**`CompetitorList.tsx` (new):**
- Renders competitor rows from the `competitorClosures` array (brand name, status pill using the same brand colors as the popup, address/city/state, and "X mi from {HS name}" when present, "★ Opportunity" tag when `isOpportunity`).
- Each row has a heart **save** button (a competitor-flavored analogue of `FavoriteButton`) wired to `toggleSavedCompetitor` with the row's snapshot, using `useTransition` + optimistic state lifted from `BrowsePage`'s saved set.
- Hover-syncs with the map via the existing `hoveredId`/`onHover` mechanism, keyed by `googlePlaceId`. (Map competitor markers will set/clear hover on mouseenter/leave so list↔map highlighting works both ways, consistent with how listing markers behave.)
- Empty state when there are zero competitor closures.

**`MapView.tsx`:**
- New prop `showListings?: boolean` (default `true`); when false, skip rendering/adding listing markers (and remove existing ones), leaving competitor pins.
- Competitor markers: add `mouseenter`/`mouseleave` that call `onHover(googlePlaceId)` / `onHover(null)` so list↔map hover highlighting is bidirectional; and highlight a competitor pin when `hoveredId === googlePlaceId`.
- **Popup save control:** add a Save toggle to the competitor popup. Because the popup is raw HTML injected into MapTiler and `escapeHtml` guards untrusted text, the save action is wired via an event listener attached to a known element inside the popup (e.g. a `data-save-place-id` button) rather than inline JS in the HTML string. The popup reflects saved state (filled vs. outline heart) based on the current saved set; clicking calls back into `BrowsePage` (via a `onToggleSaveCompetitor` callback prop, read through a ref like `onListingClickRef` to avoid rebuilding markers).

### 5. Saved page — `src/app/account/favorites/page.tsx`

- Add a second section titled **"Saved competitor locations"** below the saved listings grid.
- Fetch the user's `saved_competitors` rows (ordered by `createdAt desc`), render snapshot cards: brand name, status pill, address/city/state, and a "View on Google Maps →" link when `mapsUrl` is set.
- Update page subtitle/counts to reflect both saved listings and saved competitors (e.g. show each count). Preserve the existing empty state for listings; add an analogous empty state for the competitor section (or omit the section entirely when there are none).

### 6. Migration

- Add `savedCompetitors` to the schema barrel so Drizzle picks it up (matching how `favorites` is wired into `src/db/schema.ts` / the schema index).
- Generate the SQL migration (`db:generate`) and apply via the project's push-managed flow (`db:push`), consistent with current DB management.

## Error handling

- All write/read actions are auth-guarded; reads return `[]`/empty rather than throwing for unauthenticated callers where a non-throwing default is reasonable (mirrors `isFavorited`).
- Optimistic UI reverts automatically if the server action throws (same pattern as `FavoriteButton`).
- The competitor layer/list remains resilient: if there are zero closures, the list switch is hidden and the competitor list shows an empty state; the map renders normally.

## Testing

- Unit-test `toggleSavedCompetitor` (insert→saved:true, toggle→saved:false, unauthenticated→throws) and `getSavedCompetitorPlaceIds` (unauthenticated→[], returns saved ids), following the style of existing `src/__tests__/*.test.ts`.
- Component/interaction checks: list switch flips list content while map keeps both layers; HS-listings map toggle hides/shows listing pins independently of the competitor toggle; saving from a list row and from a map popup both update the saved set and persist.
