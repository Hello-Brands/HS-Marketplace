# Save Competitors + Browse Layer Controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save scraper-sourced competitor locations to their account, add a show/hide toggle for Hello Sugar listing pins on the map, and add a two-state `Listings | Competitors` switch that controls the left-hand list panel.

**Architecture:** A new app-owned `saved_competitors` table stores a snapshot of each saved competitor (no FK to the scraper-owned source table, which churns). Server actions mirror the existing `favorites-actions.ts`. `BrowsePage` owns a saved-set state hydrated from the server and a `listMode` switch; both the left-list competitor rows and the map pin popup call one shared toggle handler so saved state stays consistent. `MapView` gains a `showListings` prop and bidirectional competitor hover.

**Tech Stack:** Next.js (App Router, per `AGENTS.md` this is a modified Next.js — consult `node_modules/next/dist/docs/` before adding framework code), React 18, Drizzle ORM (Postgres/Neon), MapTiler SDK, Tailwind, Vitest.

## Global Constraints

- **Read `node_modules/next/dist/docs/`** before writing any Next.js framework code — APIs may differ from training data (`AGENTS.md`).
- **Never write to `competitor_opportunities`** and **never add a foreign key into it** — it is scraper-owned and reconciled (`src/db/schema/competitorOpportunities.ts` header). The new table stores a snapshot and references only `users.id`.
- **Numeric lat/lng come back from the driver as strings** — insert with `String(value)`, read with `Number(value)` (existing convention).
- **DB is push-managed** (Neon): apply schema with `npm run db:push`; also run `npm run db:generate` to record the SQL migration file for the repo, matching the existing `drizzle/` layout.
- **Auth guard pattern:** writes throw `new Error('Not authenticated')`; reads return an empty/default value when unauthenticated (mirror `favorites-actions.ts` / `isFavorited`).
- **Brand colors already used for competitors:** opportunity caramel `#B9772E`, taupe `#8F7067`, danger `#C0142F`, danger-soft `#F7DCDA`, warning-soft `#F3E4D0` (from `MapView.tsx`). Reuse these for the competitor list rows.
- No new test framework: automated tests cover pure functions and `vi.mock`-able modules only (repo has no React component test harness). UI is verified via the running dev server and `npm run build`.

---

### Task 1: `saved_competitors` schema + migration

**Files:**
- Create: `src/db/schema/savedCompetitors.ts`
- Modify: `src/db/schema.ts` (add export)

**Interfaces:**
- Produces: `savedCompetitors` pgTable; `savedCompetitorsRelations`; types `SavedCompetitor`, `NewSavedCompetitor`. Columns: `id` (text pk), `userId` (text, FK users.id cascade), `placeId` (text), `brandName` `address` `city` (text), `state` (varchar 2), `lat` `lng` (numeric 10,7), `businessStatus` (text), `mapsUrl` (text null), `createdAt` (timestamp). Unique index on `(userId, placeId)`.

- [ ] **Step 1: Create the schema file**

`src/db/schema/savedCompetitors.ts`:
```ts
import { pgTable, text, varchar, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

/**
 * A user's saved competitor locations. App-owned (the user creates these).
 *
 * Stores a SNAPSHOT of the competitor's display fields rather than referencing
 * `competitor_opportunities`: that table is scraper-owned and fully reconciled
 * each run (rows come and go), so a foreign key would delete a user's saves
 * whenever the scraper churns. `placeId` keeps the link to the source row's
 * stable Google place id without enforcing referential integrity.
 */
export const savedCompetitors = pgTable(
  "saved_competitors",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    placeId: text("place_id").notNull(), // Google place id of the saved competitor
    // Snapshot of display fields (see header for why we snapshot).
    brandName: text("brand_name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
    lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
    businessStatus: text("business_status").notNull(),
    mapsUrl: text("maps_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("saved_competitors_user_place_idx").on(table.userId, table.placeId),
  ],
)

export const savedCompetitorsRelations = relations(savedCompetitors, ({ one }) => ({
  user: one(users, {
    fields: [savedCompetitors.userId],
    references: [users.id],
  }),
}))

export type SavedCompetitor = typeof savedCompetitors.$inferSelect
export type NewSavedCompetitor = typeof savedCompetitors.$inferInsert
```

- [ ] **Step 2: Register in the schema barrel**

In `src/db/schema.ts`, add after the `favorites` export (line 12):
```ts
export * from "./schema/savedCompetitors"
```

- [ ] **Step 3: Generate the migration SQL**

Run: `npm run db:generate`
Expected: a new `drizzle/0003_*.sql` (CREATE TABLE "saved_competitors" …) and updated `drizzle/meta/` snapshot. No changes to `competitor_opportunities`.

- [ ] **Step 4: Apply to the database**

Run: `npm run db:push`
Expected: drizzle-kit reports creating table `saved_competitors`; no destructive prompts (new table only). If it prompts about anything touching `competitor_opportunities`, abort — that is a mistake.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/savedCompetitors.ts src/db/schema.ts drizzle/
git commit -m "feat(db): add saved_competitors table for user-saved competitor locations"
```

---

### Task 2: `competitorToSnapshot` pure helper (TDD)

**Files:**
- Create: `src/lib/saved-competitors.ts`
- Test: `src/__tests__/saved-competitors.test.ts`

**Interfaces:**
- Consumes: `CompetitorClosure` from `@/lib/competitor-query`.
- Produces: `interface SavedCompetitorInput { placeId, brandName, address, city, state, lat: number, lng: number, businessStatus, mapsUrl: string | null }` and `competitorToSnapshot(c: CompetitorClosure): SavedCompetitorInput`. Used by both the list rows and the map popup to build the payload for `toggleSavedCompetitor`.

- [ ] **Step 1: Write the failing test**

`src/__tests__/saved-competitors.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { competitorToSnapshot } from "@/lib/saved-competitors"
import type { CompetitorClosure } from "@/lib/competitor-query"

const closure: CompetitorClosure = {
  googlePlaceId: "place-123",
  brandId: "ewc",
  brandName: "European Wax Center",
  address: "123 Main St",
  city: "Provo",
  state: "UT",
  latitude: 40.2338,
  longitude: -111.6585,
  businessStatus: "CLOSED_PERMANENTLY",
  closedAt: "2026-05-01T00:00:00.000Z",
  nearestHsName: "Hello Sugar Provo",
  nearestHsMiles: 2.3,
  isOpportunity: true,
  mapsUrl: "https://maps.google.com/?cid=1",
}

describe("competitorToSnapshot", () => {
  it("maps a CompetitorClosure to the saved-competitor input payload", () => {
    expect(competitorToSnapshot(closure)).toEqual({
      placeId: "place-123",
      brandName: "European Wax Center",
      address: "123 Main St",
      city: "Provo",
      state: "UT",
      lat: 40.2338,
      lng: -111.6585,
      businessStatus: "CLOSED_PERMANENTLY",
      mapsUrl: "https://maps.google.com/?cid=1",
    })
  })

  it("preserves a null mapsUrl", () => {
    expect(competitorToSnapshot({ ...closure, mapsUrl: null }).mapsUrl).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- saved-competitors`
Expected: FAIL — cannot resolve `competitorToSnapshot` from `@/lib/saved-competitors`.

- [ ] **Step 3: Write the helper**

`src/lib/saved-competitors.ts`:
```ts
import type { CompetitorClosure } from "@/lib/competitor-query"

/**
 * The payload shape persisted by `toggleSavedCompetitor`. A snapshot of the
 * competitor's display fields so a saved item still renders after the scraper
 * removes the source row. Shared by the list rows and the map popup.
 */
export interface SavedCompetitorInput {
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

export function competitorToSnapshot(c: CompetitorClosure): SavedCompetitorInput {
  return {
    placeId: c.googlePlaceId,
    brandName: c.brandName,
    address: c.address,
    city: c.city,
    state: c.state,
    lat: c.latitude,
    lng: c.longitude,
    businessStatus: c.businessStatus,
    mapsUrl: c.mapsUrl,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- saved-competitors`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/saved-competitors.ts src/__tests__/saved-competitors.test.ts
git commit -m "feat: add competitorToSnapshot helper + SavedCompetitorInput type"
```

---

### Task 3: Server actions

**Files:**
- Create: `src/lib/saved-competitors-actions.ts`

**Interfaces:**
- Consumes: `SavedCompetitorInput` from `@/lib/saved-competitors`; `savedCompetitors` table; `auth`, `db`.
- Produces: `toggleSavedCompetitor(input: SavedCompetitorInput): Promise<{ saved: boolean }>` and `getSavedCompetitorPlaceIds(): Promise<string[]>`.

- [ ] **Step 1: Write the actions module**

`src/lib/saved-competitors-actions.ts`:
```ts
'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { savedCompetitors } from '@/db/schema/savedCompetitors'
import { and, eq } from 'drizzle-orm'
import type { SavedCompetitorInput } from '@/lib/saved-competitors'

export async function toggleSavedCompetitor(
  input: SavedCompetitorInput,
): Promise<{ saved: boolean }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  const userId = session.user.id

  const existing = await db.query.savedCompetitors.findFirst({
    where: and(
      eq(savedCompetitors.userId, userId),
      eq(savedCompetitors.placeId, input.placeId),
    ),
  })

  if (existing) {
    await db.delete(savedCompetitors).where(
      and(
        eq(savedCompetitors.userId, userId),
        eq(savedCompetitors.placeId, input.placeId),
      ),
    )
    return { saved: false }
  }

  await db.insert(savedCompetitors).values({
    userId,
    placeId: input.placeId,
    brandName: input.brandName,
    address: input.address,
    city: input.city,
    state: input.state,
    // numeric columns take strings (driver convention)
    lat: String(input.lat),
    lng: String(input.lng),
    businessStatus: input.businessStatus,
    mapsUrl: input.mapsUrl,
  })
  return { saved: true }
}

export async function getSavedCompetitorPlaceIds(): Promise<string[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const rows = await db.query.savedCompetitors.findMany({
    where: eq(savedCompetitors.userId, session.user.id),
    columns: { placeId: true },
  })
  return rows.map((r) => r.placeId)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (Confirms `db.query.savedCompetitors` exists — i.e. Task 1's barrel registration worked.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/saved-competitors-actions.ts
git commit -m "feat: add toggleSavedCompetitor + getSavedCompetitorPlaceIds server actions"
```

---

### Task 4: Browse page server wiring + BrowsePage saved-state plumbing

**Files:**
- Modify: `src/app/browse/page.tsx` (the `BrowseContent` Promise.all + prop pass)
- Modify: `src/components/browse/BrowsePage.tsx` (props, state, toggle handler)

**Interfaces:**
- Consumes: `getSavedCompetitorPlaceIds` (Task 3), `competitorToSnapshot` (Task 2), `toggleSavedCompetitor` (Task 3).
- Produces (within `BrowsePage`, used by Tasks 5–8): `listMode` state; `showListings` state; `savedSet: Set<string>`; `handleToggleSaveCompetitor(c: CompetitorClosure): void`; and a memoized `savedCompetitorIds: string[]` for passing to `MapView`.

- [ ] **Step 1: Fetch saved place ids in the server component**

In `src/app/browse/page.tsx`, add the import near the other lib imports (after line 5):
```ts
import { getSavedCompetitorPlaceIds } from "@/lib/saved-competitors-actions"
```
Replace the `Promise.all` block (lines 66-69) with:
```ts
  const [{ items: initialListings }, competitorClosures, savedCompetitorIds] = await Promise.all([
    getListings(parseFilters(searchParams)),
    getCompetitorClosures(),
    getSavedCompetitorPlaceIds(),
  ])
```
And pass the new prop to `<BrowsePage>` (after `competitorClosures={competitorClosures}`):
```tsx
        savedCompetitorIds={savedCompetitorIds}
```

- [ ] **Step 2: Add props + imports to BrowsePage**

In `src/components/browse/BrowsePage.tsx`, add imports (after line 13):
```ts
import { competitorToSnapshot } from "@/lib/saved-competitors"
import { toggleSavedCompetitor } from "@/lib/saved-competitors-actions"
```
Extend `BrowsePageProps` (the interface ending line 32) with:
```ts
  savedCompetitorIds?: string[]
```
And the destructured params (lines 34-38) to include it with a default:
```ts
export function BrowsePage({
  initialListings,
  competitorClosures = [],
  favoriteIds = [],
  savedCompetitorIds = [],
}: BrowsePageProps) {
```

- [ ] **Step 3: Add state + the shared toggle handler**

In `src/components/browse/BrowsePage.tsx`, after the `showCompetitors` state (line 44) add:
```ts
  // Which dataset the LEFT LIST shows. The map always shows both layers.
  const [listMode, setListMode] = useState<"listings" | "competitors">("listings")
  // Show/hide the Hello Sugar listing PIN layer on the map (independent of the
  // competitor layer toggle).
  const [showListings, setShowListings] = useState(true)
  // Saved competitor place ids, hydrated from the server and updated
  // optimistically. Shared by the list rows and the map popup so both reflect
  // the same state within the session.
  const [savedSet, setSavedSet] = useState<Set<string>>(() => new Set(savedCompetitorIds))
```
After the `handleListingClick` callback (ends line 119) add:
```ts
  // Optimistic save/unsave; reverts on error. Used by the list rows and map popup.
  const handleToggleSaveCompetitor = useCallback((c: CompetitorClosure) => {
    const placeId = c.googlePlaceId
    const wasSaved = savedSet.has(placeId)
    setSavedSet((prev) => {
      const next = new Set(prev)
      if (wasSaved) next.delete(placeId)
      else next.add(placeId)
      return next
    })
    toggleSavedCompetitor(competitorToSnapshot(c)).catch(() => {
      // revert on failure
      setSavedSet((prev) => {
        const next = new Set(prev)
        if (wasSaved) next.add(placeId)
        else next.delete(placeId)
        return next
      })
    })
  }, [savedSet])

  // Stable array form for MapView (its marker effect keys off the joined ids).
  const savedCompetitorIdList = useMemo(() => Array.from(savedSet), [savedSet])
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (`listMode`, `showListings`, `savedSet`, `handleToggleSaveCompetitor`, `savedCompetitorIdList` are defined but not all consumed yet — that is fine; they are used in Tasks 5–8. If the linter flags unused vars during `npm run build`, that resolves once Tasks 5–8 wire them in; do not delete them.)

- [ ] **Step 5: Commit**

```bash
git add src/app/browse/page.tsx src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): plumb saved-competitor state and list/layer toggles into BrowsePage"
```

---

### Task 5: SaveCompetitorButton + CompetitorList components

**Files:**
- Create: `src/components/browse/SaveCompetitorButton.tsx`
- Create: `src/components/browse/CompetitorList.tsx`

**Interfaces:**
- Consumes: `CompetitorClosure` from `@/lib/competitor-query`; `hoveredId`/`onHover` convention (string id = `googlePlaceId`).
- Produces:
  - `SaveCompetitorButton({ saved: boolean, onToggle: () => void })` — a controlled heart toggle (state lives in the parent).
  - `CompetitorList({ competitors, savedSet, onToggleSave, hoveredId, onHover })` where `onToggleSave: (c: CompetitorClosure) => void`.

- [ ] **Step 1: Create the controlled save button**

`src/components/browse/SaveCompetitorButton.tsx`:
```tsx
'use client'

interface SaveCompetitorButtonProps {
  saved: boolean
  onToggle: () => void
}

// Controlled heart toggle — parent owns the saved state so the map popup and
// the list row stay in sync. Mirrors FavoriteButton's look.
export function SaveCompetitorButton({ saved, onToggle }: SaveCompetitorButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      aria-pressed={saved}
      aria-label={saved ? 'Remove saved competitor' : 'Save competitor'}
      className="
        p-2 rounded-full bg-white/80 backdrop-blur-sm
        hover:bg-white transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500
      "
    >
      <svg
        className={`h-5 w-5 transition-colors ${saved ? 'text-hs-red-600 fill-current' : 'text-gray-600'}`}
        fill={saved ? 'currentColor' : 'none'}
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
        />
      </svg>
    </button>
  )
}
```

- [ ] **Step 2: Create the competitor list**

`src/components/browse/CompetitorList.tsx`:
```tsx
'use client'

import type { CompetitorClosure } from "@/lib/competitor-query"
import { SaveCompetitorButton } from "./SaveCompetitorButton"

interface CompetitorListProps {
  competitors: CompetitorClosure[]
  savedSet: Set<string>
  onToggleSave: (c: CompetitorClosure) => void
  hoveredId: string | null
  onHover: (id: string | null) => void
}

function statusLabel(status: string): string {
  if (status === "CLOSED_PERMANENTLY") return "Permanently Closed"
  if (status === "CLOSED_TEMPORARILY") return "Temporarily Closed"
  return status
}

export function CompetitorList({
  competitors,
  savedSet,
  onToggleSave,
  hoveredId,
  onHover,
}: CompetitorListProps) {
  if (competitors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-gray-500 text-lg mb-2">No competitor locations</p>
        <p className="text-gray-400 text-sm">Closures appear here when the monitor finds them.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">{competitors.length} competitor location{competitors.length !== 1 ? "s" : ""}</p>
      <div className="grid grid-cols-1 gap-3">
        {competitors.map((c) => {
          const permanent = c.businessStatus === "CLOSED_PERMANENTLY"
          const isHovered = hoveredId === c.googlePlaceId
          const place = [c.city, c.state].filter(Boolean).join(", ")
          return (
            <div
              key={c.googlePlaceId}
              onMouseEnter={() => onHover(c.googlePlaceId)}
              onMouseLeave={() => onHover(null)}
              className={`flex gap-3 p-4 bg-white rounded-xl border transition-all duration-200 ${
                isHovered ? "border-gray-300 shadow-md" : "border-gray-200"
              }`}
            >
              <div className="flex-1 min-w-0">
                {c.isOpportunity && (
                  <span className="inline-block text-[10px] font-bold uppercase tracking-wide bg-[#F3E4D0] text-[#B9772E] px-2 py-0.5 rounded-full mb-1">
                    ★ Opportunity
                  </span>
                )}
                <p className="text-sm font-bold text-gray-900 truncate">{c.brandName}</p>
                <span
                  className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full mt-1"
                  style={{
                    backgroundColor: permanent ? "#F7DCDA" : "#F3E4D0",
                    color: permanent ? "#C0142F" : "#B9772E",
                  }}
                >
                  {statusLabel(c.businessStatus)}
                </span>
                <p className="text-xs text-gray-500 mt-1 truncate">
                  {c.address}{place ? ` · ${place}` : ""}
                </p>
                {c.nearestHsName && c.nearestHsMiles != null && (
                  <p className="text-xs text-[#8F7067] mt-1">
                    {c.nearestHsMiles.toFixed(1)} mi from {c.nearestHsName}
                  </p>
                )}
              </div>
              <div className="flex items-start">
                <SaveCompetitorButton
                  saved={savedSet.has(c.googlePlaceId)}
                  onToggle={() => onToggleSave(c)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/browse/SaveCompetitorButton.tsx src/components/browse/CompetitorList.tsx
git commit -m "feat(browse): add CompetitorList + SaveCompetitorButton components"
```

---

### Task 6: List switch + render CompetitorList in BrowsePage

**Files:**
- Modify: `src/components/browse/BrowsePage.tsx`

**Interfaces:**
- Consumes: `listMode`/`setListMode`, `savedSet`, `handleToggleSaveCompetitor`, `hoveredId`/`setHoveredId` (Task 4); `CompetitorList` (Task 5).

- [ ] **Step 1: Import CompetitorList**

In `src/components/browse/BrowsePage.tsx`, add (after the `ListingGrid` import, line 7):
```ts
import { CompetitorList } from "./CompetitorList"
```

- [ ] **Step 2: Add the Listings | Competitors switch**

In `src/components/browse/BrowsePage.tsx`, immediately after the closing `</div>` of the View toggle segmented control (the `</div>` on line 184, before the `{/* Location search ... */}` block), insert:
```tsx
          {/* List dataset switch — only meaningful when the scraper has pushed
              at least one closure. Controls the LEFT LIST only; the map always
              shows both layers. */}
          {competitorClosures.length > 0 && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden shadow-sm">
              <button
                onClick={() => setListMode("listings")}
                aria-pressed={listMode === "listings"}
                className={`px-4 py-2 text-sm font-semibold transition-all duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  ${listMode === "listings" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                Listings
              </button>
              <button
                onClick={() => setListMode("competitors")}
                aria-pressed={listMode === "competitors"}
                className={`px-4 py-2 text-sm font-semibold transition-all duration-200 border-l border-gray-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  ${listMode === "competitors" ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                Competitors
              </button>
            </div>
          )}
```

- [ ] **Step 3: Render the right dataset in LIST view**

In `src/components/browse/BrowsePage.tsx`, replace the list-view `ListingGrid` block (the `<ListingGrid ... favoriteIds={favoriteIds} />` inside `viewMode === "list"`, lines 262-268) with:
```tsx
            {listMode === "competitors" ? (
              <CompetitorList
                competitors={competitorClosures}
                savedSet={savedSet}
                onToggleSave={handleToggleSaveCompetitor}
                hoveredId={hoveredId}
                onHover={setHoveredId}
              />
            ) : (
              <ListingGrid
                initialListings={initialListings}
                filters={filters}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                favoriteIds={favoriteIds}
              />
            )}
```

- [ ] **Step 4: Render the right dataset in the MAP-view side panel**

In `src/components/browse/BrowsePage.tsx`, replace the side-panel `ListingGrid` block (inside the `md:w-1/3` panel, the `<ListingGrid ... singleColumn />`, lines 277-283) with:
```tsx
                {listMode === "competitors" ? (
                  <CompetitorList
                    competitors={competitorClosures}
                    savedSet={savedSet}
                    onToggleSave={handleToggleSaveCompetitor}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                  />
                ) : (
                  <ListingGrid
                    initialListings={initialListings}
                    filters={filters}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                    singleColumn
                  />
                )}
```

- [ ] **Step 5: Build + manual verify**

Run: `npm run build`
Expected: PASS (compiles; no unused-var error for `listMode`/`savedSet`/`handleToggleSaveCompetitor` now that they are consumed).

Manual (dev server already runs at http://localhost:3000): open `/browse`, confirm the `Listings | Competitors` switch appears (when closures exist), flips the left list between listing cards and competitor rows, and that hovering a competitor row highlights nothing yet on the map (map wiring is Task 7). Saving a competitor heart toggles fill and persists across a page refresh.

- [ ] **Step 6: Commit**

```bash
git add src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): add Listings|Competitors list switch and render competitor list"
```

---

### Task 7: MapView — `showListings`, bidirectional competitor hover, popup save

**Files:**
- Modify: `src/components/browse/MapView.tsx`

**Interfaces:**
- Consumes: `competitors`, `showCompetitors` (existing); new `showListings?: boolean`, `savedPlaceIds?: string[]`, `onToggleSaveCompetitor?: (c: CompetitorClosure) => void`.
- Produces: listing markers skipped when `showListings === false`; competitor markers tagged by `googlePlaceId` for hover; popup heart reflecting `savedPlaceIds` and calling `onToggleSaveCompetitor`.

- [ ] **Step 1: Extend props + add refs**

In `src/components/browse/MapView.tsx`, extend `MapViewProps` (the interface ending line 20) with:
```ts
  showListings?: boolean
  savedPlaceIds?: string[]
  onToggleSaveCompetitor?: (c: CompetitorClosure) => void
```
Add to the destructured params (after `showCompetitors = true,` line 161):
```ts
  showListings = true,
  savedPlaceIds = [],
  onToggleSaveCompetitor,
```
Change the competitor markers ref (line 166) to tag ids, and add a save-handler ref. Replace:
```ts
  const competitorMarkers = useRef<maptilersdk.Marker[]>([])
```
with:
```ts
  const competitorMarkers = useRef<{ marker: maptilersdk.Marker; id: string }[]>([])
  // Read inside marker listeners without making it a dependency of the marker effect.
  const onToggleSaveCompetitorRef = useRef(onToggleSaveCompetitor)
  onToggleSaveCompetitorRef.current = onToggleSaveCompetitor
```

- [ ] **Step 2: Skip listing markers when hidden**

In `src/components/browse/MapView.tsx`, inside the listings marker effect `addMarkers` (after `markers.current = []`, line 205), add an early bail so hiding clears them:
```ts
      if (!showListings) return
```
And add `showListings` to that effect's dependency array. Change `}, [listings, onHover])` (line 287) to:
```ts
  }, [listings, onHover, showListings])
```

- [ ] **Step 3: Add a heart control to the competitor popup HTML**

In `src/components/browse/MapView.tsx`, change `competitorPopupHtml` to accept a `saved` flag and render a save button with a stable data attribute. Replace the signature line (line 78) and the `return` template so it includes the button. Specifically, change:
```ts
function competitorPopupHtml(c: CompetitorClosure): string {
```
to:
```ts
function competitorPopupHtml(c: CompetitorClosure, saved: boolean): string {
```
and insert this just before the final closing `</div>` of the returned template (immediately after `${maps}` on line 111):
```ts
```
Then add the button definition above the `return` (after the `maps` const, line 99) :
```ts
  const saveBtn = `
    <button type="button" data-save-place-id="${escapeHtml(c.googlePlaceId)}" aria-pressed="${saved}"
      style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;font-weight:600;cursor:pointer;background:none;border:none;padding:0;color:${saved ? "#ED1845" : "#8F7067"};">
      <span style="font-size:14px;line-height:1;">${saved ? "♥" : "♡"}</span>${saved ? "Saved" : "Save competitor"}
    </button>`
```
and add `${saveBtn}` into the template right after `${maps}`:
```ts
      ${maps}
      ${saveBtn}
```

- [ ] **Step 4: Wire popup save + hover + id-tagging in the competitor effect**

In `src/components/browse/MapView.tsx`, in the competitor-layer effect (lines 393-440), make these changes inside the `for (const c of valid)` loop:

Replace the popup creation (`.setHTML(competitorPopupHtml(c))`, line 415) with:
```ts
        }).setHTML(competitorPopupHtml(c, savedPlaceIds.includes(c.googlePlaceId)))
```
After the `popup.on(...)`/marker creation, wire the save button each time the popup opens (MapTiler recreates the popup DOM on open). Add after the marker is created (after the `.addTo(m)` chain, line 422):
```ts
        popup.on("open", () => {
          const btn = popup
            .getElement()
            ?.querySelector<HTMLButtonElement>("[data-save-place-id]")
          btn?.addEventListener("click", (e) => {
            e.stopPropagation()
            onToggleSaveCompetitorRef.current?.(c)
          })
        })
```
Change the marker push (line 434) to tag the id:
```ts
        competitorMarkers.current.push({ marker, id: c.googlePlaceId })
```
Update the clear loop at the top of `apply` (line 399) to the tagged shape:
```ts
      competitorMarkers.current.forEach(({ marker }) => marker.remove())
```
Add `savedPlaceIds` to the effect deps via a stable join key. Change `}, [competitors, showCompetitors])` (line 440) to:
```ts
  }, [competitors, showCompetitors, savedPlaceIds.join(",")])
```
(Competitor sets are small — see `competitor-query.ts` — so rebuilding markers when the saved set changes is cheap and keeps the popup heart correct.)

- [ ] **Step 5: Highlight competitor pins on hover (list → map)**

In `src/components/browse/MapView.tsx`, add a new effect after the existing listing-hover effect (after line 307). It scales the matching competitor pin while preserving its 45° rotation:
```ts
  // Highlight the competitor pin matching the hovered list row.
  useEffect(() => {
    for (const { marker, id } of competitorMarkers.current) {
      const el = marker.getElement()
      const inner = el.firstElementChild as HTMLElement | null
      if (!inner) continue
      if (id === hoveredId) {
        inner.style.transform = "rotate(45deg) scale(1.35)"
        el.style.zIndex = "6"
      } else {
        inner.style.transform = "rotate(45deg)"
        el.style.zIndex = ""
      }
    }
  }, [hoveredId])
```
Also make the pin emit hover so map → list works. In the competitor effect, replace the existing `mouseenter`/`mouseleave` handlers (lines 425-432) with versions that also call `onHover`:
```ts
        el.addEventListener("mouseenter", () => {
          inner.style.transform = "rotate(45deg) scale(1.25)"
          el.style.zIndex = "5"
          onHover(c.googlePlaceId)
        })
        el.addEventListener("mouseleave", () => {
          inner.style.transform = "rotate(45deg)"
          el.style.zIndex = ""
          onHover(null)
        })
```

- [ ] **Step 6: Build + typecheck**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/browse/MapView.tsx
git commit -m "feat(map): add listing-layer toggle support, competitor hover sync, and popup save"
```

---

### Task 8: Map HS-listings toggle pill + wire MapView save props

**Files:**
- Modify: `src/components/browse/BrowsePage.tsx`

**Interfaces:**
- Consumes: `showListings`/`setShowListings`, `savedCompetitorIdList`, `handleToggleSaveCompetitor` (Task 4); `MapView` new props (Task 7).

- [ ] **Step 1: Pass the new props to MapView**

In `src/components/browse/BrowsePage.tsx`, in the `<MapView ... />` block (lines 289-298), add these props (after `showCompetitors={showCompetitors}`):
```tsx
                showListings={showListings}
                savedPlaceIds={savedCompetitorIdList}
                onToggleSaveCompetitor={handleToggleSaveCompetitor}
```

- [ ] **Step 2: Add the top-left HS-listings toggle pill**

In `src/components/browse/BrowsePage.tsx`, immediately after the opening `<MapView ... />` element and before the competitor-toggle block (i.e. right after the `/>` that closes `<MapView`, around line 298), insert the listings pill:
```tsx
              {/* Hello Sugar listing layer toggle (top-left), mirroring the
                  competitor toggle on the right. Independent — both layers can
                  show at once. */}
              <button
                type="button"
                onClick={() => setShowListings((v) => !v)}
                aria-pressed={showListings}
                title={showListings ? "Hide Hello Sugar listings" : "Show Hello Sugar listings"}
                className={`
                  absolute top-3 left-3 z-10 inline-flex items-center gap-2
                  rounded-full border px-3 py-2 text-sm font-semibold shadow-md
                  transition-colors min-h-[40px]
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                  ${showListings
                    ? "bg-white border-gray-300 text-gray-800 hover:bg-gray-50"
                    : "bg-gray-900/85 border-gray-900 text-white hover:bg-gray-900"}
                `}
              >
                {/* pink dot mirrors the listing pin shape */}
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-full border border-white"
                  style={{ backgroundColor: showListings ? "#db2777" : "#9ca3af" }}
                />
                <span>
                  Hello Sugar listings
                  <span className="ml-1 tabular-nums opacity-60">({initialListings.length})</span>
                </span>
              </button>
```

- [ ] **Step 3: Build + manual verify**

Run: `npm run build`
Expected: PASS.

Manual (http://localhost:3000/browse, map view):
- Top-left pill toggles HS listing pins on/off; top-right pill still toggles competitor pins independently; both can be on together.
- Hovering a competitor row in the list highlights its diamond pin; hovering a pin highlights its row.
- Clicking a competitor pin opens the popup; the heart shows Saved/Save and toggling it updates both the popup and the list row; state survives a refresh.

- [ ] **Step 4: Commit**

```bash
git add src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): add Hello Sugar listing-layer map toggle and wire competitor save into map"
```

---

### Task 9: Saved page — competitor section

**Files:**
- Modify: `src/app/account/favorites/page.tsx`

**Interfaces:**
- Consumes: `savedCompetitors` table (Task 1).

- [ ] **Step 1: Fetch saved competitors**

In `src/app/account/favorites/page.tsx`, add imports (after the favorites import, line 5):
```ts
import { savedCompetitors } from '@/db/schema/savedCompetitors'
```
Add a fetch helper after `getFavoriteListings` (after line 58):
```ts
async function getSavedCompetitors(userId: string) {
  return db.query.savedCompetitors.findMany({
    where: eq(savedCompetitors.userId, userId),
    orderBy: (sc, { desc }) => [desc(sc.createdAt)],
  })
}

function competitorStatusLabel(status: string): string {
  if (status === 'CLOSED_PERMANENTLY') return 'Permanently Closed'
  if (status === 'CLOSED_TEMPORARILY') return 'Temporarily Closed'
  return status
}
```

- [ ] **Step 2: Call it in the page component + update subtitle**

In `src/app/account/favorites/page.tsx`, in `FavoritesPage` after `const favoriteListings = await getFavoriteListings(session.user.id)` (line 84) add:
```ts
  const savedComps = await getSavedCompetitors(session.user.id)
```
Update the `SiteHeader` subtitle (line 91) to:
```tsx
        subtitle={`${favoriteListings.length} saved listing${favoriteListings.length !== 1 ? 's' : ''} · ${savedComps.length} competitor${savedComps.length !== 1 ? 's' : ''}`}
```

- [ ] **Step 3: Render the competitor section**

In `src/app/account/favorites/page.tsx`, immediately before the final closing `</div>` of the content container (the `</div>` on line 163, right after the listings grid/empty-state conditional ends on line 162), insert:
```tsx
        {savedComps.length > 0 && (
          <section className="mt-10">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Saved competitor locations</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {savedComps.map((c) => {
                const permanent = c.businessStatus === 'CLOSED_PERMANENTLY'
                const place = [c.city, c.state].filter(Boolean).join(', ')
                return (
                  <div
                    key={c.id}
                    className="flex flex-col gap-2 p-4 bg-white rounded-xl border border-gray-200"
                  >
                    <p className="text-sm font-bold text-gray-900 truncate">{c.brandName}</p>
                    <span
                      className="inline-block w-fit text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: permanent ? '#F7DCDA' : '#F3E4D0',
                        color: permanent ? '#C0142F' : '#B9772E',
                      }}
                    >
                      {competitorStatusLabel(c.businessStatus)}
                    </span>
                    <p className="text-xs text-gray-500 truncate">
                      {c.address}{place ? ` · ${place}` : ''}
                    </p>
                    {c.mapsUrl && (
                      <a
                        href={c.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700"
                      >
                        View on Google Maps →
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
```

- [ ] **Step 4: Build + manual verify**

Run: `npm run build`
Expected: PASS.

Manual: save a competitor on `/browse`, open `/account/favorites`, confirm the "Saved competitor locations" section lists it with status pill and a working Google Maps link, and the header count reflects it.

- [ ] **Step 5: Commit**

```bash
git add src/app/account/favorites/page.tsx
git commit -m "feat(account): show saved competitor locations on the Saved page"
```

---

## Self-Review

**Spec coverage:**
- Saved-competitors storage (new table, no FK, snapshot) → Task 1. ✓
- Server actions → Task 3 (+ pure helper Task 2). ✓
- Browse data flow / state → Task 4. ✓
- List switch (two-state) → Task 6. ✓
- Competitor list with per-row save → Tasks 5, 6. ✓
- Map HS-listings toggle (top-left) → Tasks 7 (prop), 8 (pill). ✓
- Map popup save → Task 7. ✓
- Bidirectional hover → Task 7. ✓
- Saved page section → Task 9. ✓
- Migration → Task 1. ✓
- Testing (pure helper unit test; manual UI verification; no new harness) → Task 2 + manual steps. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `SavedCompetitorInput` (Task 2) is consumed unchanged by `toggleSavedCompetitor` (Task 3) and `competitorToSnapshot` (Task 2). `handleToggleSaveCompetitor(c: CompetitorClosure)` (Task 4) is the single signature passed to `CompetitorList.onToggleSave` (Tasks 5/6) and `MapView.onToggleSaveCompetitor` (Tasks 7/8). `savedSet: Set<string>` (Task 4) → `CompetitorList` (Task 5); `savedCompetitorIdList: string[]` (Task 4) → `MapView.savedPlaceIds` (Task 7). `competitorMarkers` ref reshaped to `{ marker, id }` consistently in Task 7 (clear loop, push, hover effect). ✓

**Note for executor:** Line numbers reference the files' current state at plan-writing time; earlier tasks shift later lines within the same file (Tasks 4, 6, 8 all edit `BrowsePage.tsx`). Locate edits by the quoted anchor code, not the line number.
