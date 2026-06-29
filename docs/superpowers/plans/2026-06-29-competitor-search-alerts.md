# Competitor-Aware Search & Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make competitor closures honor the geographic filters, move the two map-layer toggles into the filter bar, persist them onto saved searches, and add a weekly cron that emails saved-search owners a digest of newly-scraped competitors in range.

**Architecture:** All non-trivial logic lives in pure, unit-tested modules (`competitor-filter.ts`, `alert-match.ts`, the email HTML builder); server actions, the browse page, and a new cron route compose those pure pieces. The cron uses an app-owned `competitor_alert_log` ledger (seeded at save-time) to detect "new" without trusting the scraper's `syncedAt`.

**Tech Stack:** Next.js 15 (App Router, server components + server actions + route handlers), TypeScript, Drizzle ORM (Neon, push-managed), nuqs (URL filter state), Resend, Vitest (node env), Vercel Cron.

## Global Constraints

These bind every task:

- **Schema apply is DEFERRED to the controller.** Tasks add/modify Drizzle schema files only; do **not** run `drizzle-kit push` inside a task. Drizzle's `$inferSelect`/`$inferInsert` types make all downstream code type-check and unit-test without the DB columns existing yet. The controller runs `npx drizzle-kit push` at the end (with the user). Memory: this project is push-managed.
- **New columns:** `alerts.includeListings` and `alerts.includeCompetitors` are `boolean NOT NULL DEFAULT true` — the default backfills existing saved searches to `true`, preserving today's listing-alert behavior.
- **New table `competitor_alert_log`:** PK `(alert_id, google_place_id)`; `alert_id` references `alerts.id` (text) `ON DELETE CASCADE`. The app **owns** this table (reads + writes). `competitor_opportunities` stays strictly read-only.
- **Competitor scope = radius/center (when all three set) AND states (when non-empty).** No geo + no states → all competitors on the browse view; for **alerts**, such an unscoped saved search is **skipped** (would match every closure).
- **Toggle semantics:** the Hello Sugar toggle gates listing alerts; the competitor toggle gates competitor alerts; `alerts.notifyEnabled` is the master email switch.
- **Toggles are nuqs URL state:** `parseAsBoolean.withDefault(true)`, rendered in `FilterBar` (covers mobile via `MobileFilterDrawer`, which renders `<FilterBar />`). New-search default for both = on.
- **Email:** one digest per saved search per run; recipient = saved-search owner; new template in `src/lib/email.ts` matching the existing inline-HTML style; unsubscribe footer → `/account/alerts`.
- **Cron:** weekly `"0 3 * * 2"` (Tue 03:00 UTC ≈ Mon evening US, after the Monday scraper run); `GET` handler; auth via `Authorization: Bearer ${process.env.CRON_SECRET}` (already in `src/lib/env.ts`); registered in the existing `vercel.json` `crons` array. Write the log **after** a successful send (`onConflictDoNothing`); a crash risks a re-send, never a missed alert.
- **DB barrel:** new schema files must be re-exported from `src/db/schema.ts` (the file `src/db/index.ts` imports as `* as schema`).
- **Tests:** Vitest, node env, under `src/__tests__/**/*.test.ts` (only `.test.ts` is collected). Pure modules must not import `server-only` or `@/db`; type-only imports (`import type`) are erased and safe. Components are not unit-tested (no RTL).
- **Per-step gates (Windows):** `npx tsc --noEmit` and `npx vitest run <file>`. Do NOT run `next build` (Windows `.next` lock), `npm run lint` (pre-existing broken), or start the dev server.

---

### Task 1: Schema — alerts columns + competitor_alert_log table

**Files:**
- Modify: `src/db/schema/alerts.ts`
- Create: `src/db/schema/competitorAlertLog.ts`
- Modify: `src/db/schema.ts` (barrel)

**Interfaces:**
- Produces (used by Tasks 4, 5, 7, 8): `alerts.includeListings`, `alerts.includeCompetitors` (boolean); table `competitorAlertLog` with columns `alertId`, `googlePlaceId`, `alertedAt`.

- [ ] **Step 1: Add the two boolean columns to `alerts`**

In `src/db/schema/alerts.ts`, add the columns just after the `notifyEnabled` line (line 25):

```ts
  // Per-search email toggle
  notifyEnabled: boolean("notify_enabled").default(true).notNull(),
  // Layer toggles captured from the browse filter bar; gate which alerts fire.
  includeListings: boolean("include_listings").default(true).notNull(),
  includeCompetitors: boolean("include_competitors").default(true).notNull(),
```

(`boolean` is already imported on line 1.)

- [ ] **Step 2: Create the ledger table**

Create `src/db/schema/competitorAlertLog.ts`:

```ts
import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core"
import { alerts } from "./alerts"

/**
 * App-owned ledger of competitor closures already accounted for per saved
 * search — both ones we've emailed and ones seeded as a baseline at save time.
 * Lets the weekly cron detect genuinely-new competitors without trusting the
 * scraper's `synced_at` (which is rewritten on every reconcile).
 *
 * `google_place_id` is NOT a foreign key — competitor_opportunities rows come
 * and go and the app never references into that table.
 */
export const competitorAlertLog = pgTable(
  "competitor_alert_log",
  {
    alertId: text("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    googlePlaceId: text("google_place_id").notNull(),
    alertedAt: timestamp("alerted_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.alertId, table.googlePlaceId] })],
)

export type CompetitorAlertLogRow = typeof competitorAlertLog.$inferSelect
```

- [ ] **Step 3: Register in the schema barrel**

In `src/db/schema.ts`, add an export alongside the others (e.g. after the `alerts` export):

```ts
export * from "./schema/competitorAlertLog"
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/alerts.ts src/db/schema/competitorAlertLog.ts src/db/schema.ts
git commit -m "feat(competitors): alerts toggle columns + competitor_alert_log table"
```

---

### Task 2: Pure competitor scope filter

**Files:**
- Create: `src/lib/competitor-filter.ts`
- Test: `src/__tests__/competitor-filter.test.ts`

**Interfaces:**
- Consumes: `isWithinRadius` from `@/lib/geo`.
- Produces (used by Tasks 3, 4, 8): `CompetitorScope`, `competitorInScope`, `filterCompetitorsByScope`, `scopeIsBounded`, `selectUnloggedCompetitors`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/competitor-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  competitorInScope,
  filterCompetitorsByScope,
  scopeIsBounded,
  selectUnloggedCompetitors,
} from "@/lib/competitor-filter"

// Phoenix center; ~3 mi point is in a 25 mi radius, Dallas is far out.
const phx = { latitude: 33.45, longitude: -112.07, state: "AZ", googlePlaceId: "phx" }
const phxNear = { latitude: 33.5, longitude: -112.07, state: "AZ", googlePlaceId: "near" } // ~3.5 mi
const dallas = { latitude: 32.78, longitude: -96.8, state: "TX", googlePlaceId: "dal" }

describe("competitorInScope", () => {
  it("passes everything when scope has no geo and no states", () => {
    expect(competitorInScope(dallas, {})).toBe(true)
  })
  it("filters by state when states are set", () => {
    expect(competitorInScope(phx, { states: ["AZ"] })).toBe(true)
    expect(competitorInScope(dallas, { states: ["AZ"] })).toBe(false)
  })
  it("filters by radius when center+radius are set", () => {
    const scope = { centerLat: 33.45, centerLng: -112.07, radiusMiles: 25 }
    expect(competitorInScope(phxNear, scope)).toBe(true)
    expect(competitorInScope(dallas, scope)).toBe(false)
  })
  it("requires BOTH state and radius when both are set", () => {
    const scope = { centerLat: 33.45, centerLng: -112.07, radiusMiles: 25, states: ["TX"] }
    expect(competitorInScope(phxNear, scope)).toBe(false) // in radius, wrong state
  })
})

describe("filterCompetitorsByScope", () => {
  it("returns only the in-scope competitors", () => {
    const out = filterCompetitorsByScope([phxNear, dallas], {
      centerLat: 33.45, centerLng: -112.07, radiusMiles: 25,
    })
    expect(out.map((c) => c.googlePlaceId)).toEqual(["near"])
  })
})

describe("scopeIsBounded", () => {
  it("is false with neither geo nor states", () => {
    expect(scopeIsBounded({})).toBe(false)
    expect(scopeIsBounded({ states: [] })).toBe(false)
  })
  it("is true with states or full geo", () => {
    expect(scopeIsBounded({ states: ["AZ"] })).toBe(true)
    expect(scopeIsBounded({ centerLat: 1, centerLng: 2, radiusMiles: 10 })).toBe(true)
  })
  it("is false with a partial geo (missing radius)", () => {
    expect(scopeIsBounded({ centerLat: 1, centerLng: 2 })).toBe(false)
  })
})

describe("selectUnloggedCompetitors", () => {
  it("returns only competitors not in the logged set", () => {
    const out = selectUnloggedCompetitors([phx, dallas], new Set(["phx"]))
    expect(out.map((c) => c.googlePlaceId)).toEqual(["dal"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/competitor-filter.test.ts`
Expected: FAIL — module `@/lib/competitor-filter` does not exist.

- [ ] **Step 3: Implement the module**

Create `src/lib/competitor-filter.ts`:

```ts
import { isWithinRadius } from "./geo"

export interface CompetitorScope {
  centerLat?: number | null
  centerLng?: number | null
  radiusMiles?: number | null
  states?: string[]
}

/** Minimal shape needed to test a competitor against a scope. */
export interface ScopedCompetitor {
  googlePlaceId: string
  latitude: number
  longitude: number
  state: string
}

/**
 * True if the competitor satisfies the scope's state set (when any) AND its
 * radius (when a full center+radius is set). No geo and no states → always true.
 */
export function competitorInScope(c: ScopedCompetitor, scope: CompetitorScope): boolean {
  if (scope.states && scope.states.length > 0) {
    if (!scope.states.includes(c.state)) return false
  }
  if (scope.centerLat != null && scope.centerLng != null && scope.radiusMiles != null) {
    if (!isWithinRadius(scope.centerLat, scope.centerLng, c.latitude, c.longitude, scope.radiusMiles)) {
      return false
    }
  }
  return true
}

export function filterCompetitorsByScope<T extends ScopedCompetitor>(
  list: T[],
  scope: CompetitorScope
): T[] {
  return list.filter((c) => competitorInScope(c, scope))
}

/** True when the scope can actually narrow competitors (has full geo or states). */
export function scopeIsBounded(scope: CompetitorScope): boolean {
  const hasGeo =
    scope.centerLat != null && scope.centerLng != null && scope.radiusMiles != null
  const hasStates = !!(scope.states && scope.states.length > 0)
  return hasGeo || hasStates
}

export function selectUnloggedCompetitors<T extends { googlePlaceId: string }>(
  inScope: T[],
  loggedPlaceIds: Set<string>
): T[] {
  return inScope.filter((c) => !loggedPlaceIds.has(c.googlePlaceId))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/competitor-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/competitor-filter.ts src/__tests__/competitor-filter.test.ts
git commit -m "feat(competitors): pure scope filter + unlogged selection"
```

---

### Task 3: Apply the scope filter in getCompetitorClosures + browse page

**Files:**
- Modify: `src/lib/competitor-query.ts`
- Modify: `src/app/browse/page.tsx`

**Interfaces:**
- Consumes: `CompetitorScope`, `filterCompetitorsByScope` (Task 2); `boundingBox` from `@/lib/geo`.
- Produces (used by Tasks 4, 8): `getCompetitorClosures(scope?: CompetitorScope)`.

- [ ] **Step 1: Change `getCompetitorClosures` to accept a scope**

In `src/lib/competitor-query.ts`, replace the import line and the function. Replace the `ViewportBounds` interface block and the `getCompetitorClosures` function (lines ~30–90) with:

```ts
import { boundingBox } from "./geo"
import { filterCompetitorsByScope, type CompetitorScope } from "./competitor-filter"

// (CompetitorClosure interface above stays unchanged.)

/**
 * Fetch competitor closures, optionally narrowed to a scope (radius/center +
 * states). When a full center+radius is set we prefilter with a bounding box
 * (uses the geo index), then apply the precise scope filter in JS — the closure
 * set is small. With no scope, returns all rows (the default browse view).
 *
 * Resilient by design: returns [] if the scraper table is empty/unavailable.
 */
export async function getCompetitorClosures(
  scope?: CompetitorScope
): Promise<CompetitorClosure[]> {
  try {
    let where = undefined
    if (
      scope?.centerLat != null &&
      scope.centerLng != null &&
      scope.radiusMiles != null
    ) {
      const box = boundingBox(scope.centerLat, scope.centerLng, scope.radiusMiles)
      where = and(
        gte(competitorOpportunities.lat, String(box.latMin)),
        lte(competitorOpportunities.lat, String(box.latMax)),
        gte(competitorOpportunities.lng, String(box.lngMin)),
        lte(competitorOpportunities.lng, String(box.lngMax))
      )
    }

    const rows = await db.select().from(competitorOpportunities).where(where)

    const mapped: CompetitorClosure[] = rows.map((r) => ({
      googlePlaceId: r.googlePlaceId,
      brandId: r.brandId,
      brandName: r.brandName,
      address: r.address,
      city: r.city,
      state: r.state,
      latitude: Number(r.lat),
      longitude: Number(r.lng),
      businessStatus: r.businessStatus,
      closedAt: r.closedAt ? r.closedAt.toISOString() : null,
      nearestHsName: r.nearestHsName,
      nearestHsMiles: r.nearestHsMiles != null ? Number(r.nearestHsMiles) : null,
      isOpportunity: r.isOpportunity,
      mapsUrl: r.mapsUrl,
    }))

    return scope ? filterCompetitorsByScope(mapped, scope) : mapped
  } catch (err) {
    console.error(
      "getCompetitorClosures failed; rendering map without competitor pins",
      err
    )
    return []
  }
}
```

Remove the now-unused `ViewportBounds` interface (it was only used by the old signature). Keep the existing `import { and, gte, lte } from "drizzle-orm"` line — all three are still used.

- [ ] **Step 2: Confirm there are no other callers that break**

Run: `npx vitest run --reporter=dot 2>/dev/null; grep -rn "getCompetitorClosures" src` (or use your editor search). Expected callers: `src/app/browse/page.tsx` (updated next) and nothing else yet. If any other caller passes a `ViewportBounds`, update it to pass a `CompetitorScope` (same field names: `centerLat/centerLng/radiusMiles`, no `latMin` etc.).

- [ ] **Step 3: Pass the scope from the browse page**

In `src/app/browse/page.tsx`, in `BrowseContent`, compute filters once and pass the geo+state scope to `getCompetitorClosures`. Replace the `Promise.all` block (lines ~67–71):

```ts
  const filters = parseFilters(searchParams)
  const [{ items: initialListings }, competitorClosures, savedCompetitorIds] = await Promise.all([
    getListings(filters),
    getCompetitorClosures({
      centerLat: filters.centerLat,
      centerLng: filters.centerLng,
      radiusMiles: filters.radiusMiles,
      states: filters.states,
    }),
    getSavedCompetitorPlaceIds(),
  ])
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/competitor-query.ts src/app/browse/page.tsx
git commit -m "feat(competitors): radius+state filtering on browse competitors"
```

---

### Task 4: Persist toggles server-side + ledger helpers + baseline seeding

**Files:**
- Modify: `src/lib/alert-actions.ts`
- Create: `src/lib/competitor-alert-log.ts`

**Interfaces:**
- Consumes: `getCompetitorClosures` (Task 3); `scopeIsBounded` (Task 2); `alerts.includeListings/includeCompetitors`, `competitorAlertLog` (Task 1).
- Produces (used by Task 5 client + Task 8 cron): `AlertInput` now accepts `includeListings?: boolean` and `includeCompetitors?: boolean`; `getLoggedCompetitorPlaceIds(alertId)`, `recordCompetitorAlerts(alertId, placeIds)`.

- [ ] **Step 1: Create the ledger DB helpers**

Create `src/lib/competitor-alert-log.ts`:

```ts
import "server-only"
import { db } from "@/db"
import { competitorAlertLog } from "@/db/schema/competitorAlertLog"
import { eq } from "drizzle-orm"

/** Place IDs already logged (emailed or baseline-seeded) for a saved search. */
export async function getLoggedCompetitorPlaceIds(alertId: string): Promise<Set<string>> {
  const rows = await db
    .select({ placeId: competitorAlertLog.googlePlaceId })
    .from(competitorAlertLog)
    .where(eq(competitorAlertLog.alertId, alertId))
  return new Set(rows.map((r) => r.placeId))
}

/** Record competitors as accounted-for for a saved search (idempotent). */
export async function recordCompetitorAlerts(
  alertId: string,
  googlePlaceIds: string[]
): Promise<void> {
  if (googlePlaceIds.length === 0) return
  await db
    .insert(competitorAlertLog)
    .values(googlePlaceIds.map((googlePlaceId) => ({ alertId, googlePlaceId })))
    .onConflictDoNothing()
}
```

- [ ] **Step 2: Accept + persist the toggle columns in alert-actions**

In `src/lib/alert-actions.ts`:

Add to `alertSchema` (after `notifyEnabled`, line 39):

```ts
    notifyEnabled: z.boolean().optional(),
    includeListings: z.boolean().optional(),
    includeCompetitors: z.boolean().optional(),
```

Add to `toRow` (after the `notifyEnabled` line, line 58):

```ts
    notifyEnabled: data.notifyEnabled ?? true,
    includeListings: data.includeListings ?? true,
    includeCompetitors: data.includeCompetitors ?? true,
```

Add to `updateAlert`'s patch block (after the `notifyEnabled` line, line 103):

```ts
  if ("notifyEnabled" in d) patch.notifyEnabled = d.notifyEnabled
  if ("includeListings" in d) patch.includeListings = d.includeListings ?? true
  if ("includeCompetitors" in d) patch.includeCompetitors = d.includeCompetitors ?? true
```

- [ ] **Step 3: Add baseline seeding and wire it into create/update**

In `src/lib/alert-actions.ts`, add imports near the top (after the existing imports):

```ts
import { getCompetitorClosures } from "@/lib/competitor-query"
import { scopeIsBounded } from "@/lib/competitor-filter"
import { recordCompetitorAlerts } from "@/lib/competitor-alert-log"
```

Add a private helper (place it above `createAlert`):

```ts
/**
 * Seed the competitor ledger with all competitors currently in a saved search's
 * scope, WITHOUT emailing — so the first weekly cron run doesn't blast every
 * pre-existing closure. No-op when the scope can't narrow competitors.
 */
async function seedCompetitorLog(
  alertId: string,
  scope: { centerLat: number | null; centerLng: number | null; radiusMiles: number | null; states: string[] }
) {
  if (!scopeIsBounded(scope)) return
  const inScope = await getCompetitorClosures(scope)
  await recordCompetitorAlerts(alertId, inScope.map((c) => c.googlePlaceId))
}
```

In `createAlert`, after the insert returns `alert` and before `revalidatePath`:

```ts
  if (alert.includeCompetitors) {
    await seedCompetitorLog(alert.id, {
      centerLat: alert.centerLat,
      centerLng: alert.centerLng,
      radiusMiles: alert.radiusMiles,
      states: alert.states ?? [],
    })
  }
```

In `updateAlert`, after `await db.update(...).where(eq(alerts.id, id))` and before `revalidatePath`, seed when the competitor toggle flips off→on:

```ts
  const turnedCompetitorsOn =
    existing.includeCompetitors === false && patch.includeCompetitors === true
  if (turnedCompetitorsOn) {
    await seedCompetitorLog(id, {
      centerLat: (patch.centerLat as number | null | undefined) ?? existing.centerLat,
      centerLng: (patch.centerLng as number | null | undefined) ?? existing.centerLng,
      radiusMiles: (patch.radiusMiles as number | null | undefined) ?? existing.radiusMiles,
      states: ((patch.states as string[] | undefined) ?? existing.states) ?? [],
    })
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alert-actions.ts src/lib/competitor-alert-log.ts
git commit -m "feat(competitors): persist alert toggles + baseline-seed competitor ledger"
```

---

### Task 5: Move the two toggles into the filter bar (client)

**Files:**
- Modify: `src/components/browse/FilterBar.tsx`
- Modify: `src/components/browse/BrowsePage.tsx`
- Modify: `src/components/browse/SaveSearchButton.tsx`

**Interfaces:**
- Consumes: `createAlert` now accepts `includeListings`/`includeCompetitors` (Task 4).
- Produces: `useListingFilters()` now includes `showListings` and `showCompetitors` (boolean, default true).

- [ ] **Step 1: Add the nuqs boolean params + a toggle component**

In `src/components/browse/FilterBar.tsx`, add `parseAsBoolean` to the nuqs import (line 4):

```ts
import { parseAsArrayOf, parseAsBoolean, parseAsFloat, parseAsInteger, parseAsString, useQueryStates } from "nuqs"
```

Add the two params inside `useListingFilters()` (after `centerLabel`, line 51):

```ts
    centerLabel: parseAsString.withDefault(""),
    // Map-layer visibility; persisted onto a saved search and gating its alerts.
    showListings: parseAsBoolean.withDefault(true),
    showCompetitors: parseAsBoolean.withDefault(true),
```

Add a `LayerToggles` component at the end of the file:

```tsx
// ---- Map-layer toggles (Hello Sugar / Competitors) -------------------------
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

Render `<LayerToggles />` inside the `FilterBar` row — add it right after the "Years Open" `FilterPopover` closes and before the `{/* Spacer */}` line (~line 248):

```tsx
          <LayerToggles />

          {/* Spacer */}
          <div className="flex-1" />
```

- [ ] **Step 2: Remove the overlay buttons and derive visibility from filters**

In `src/components/browse/BrowsePage.tsx`:

Delete the two local toggle states (lines 48–49 and 52–54):

```ts
  // DELETE these three useState lines:
  // const [showCompetitors, setShowCompetitors] = useState(true)
  // const [showListings, setShowListings] = useState(true)
```

(Keep `listMode`'s `useState`.) After `const [rawFilters, setFilters] = useListingFilters()` (line 67), derive the toggles:

```ts
  const showListings = rawFilters.showListings
  const showCompetitors = rawFilters.showCompetitors
```

Delete the entire Hello Sugar overlay `<button>` block (lines ~399–427) and the competitor overlay `<button>` block (lines ~429–467), including the `{competitorClosures.length > 0 && ( ... )}` wrapper around the competitor button. Leave the `RadiusSearchHint` block that follows. The `<MapView ... showCompetitors={showCompetitors} showListings={showListings} ... />` usage (lines ~385–397) stays unchanged — it now reads the derived consts.

If `useState` becomes unused after this edit, remove it from the React import on line 3 (`useCallback, useMemo, useRef, useState` → drop `useState` only if no other `useState` remains; `listMode`, `viewMode`, etc. still use it, so keep it).

- [ ] **Step 3: Pass the toggles into the saved search**

In `src/components/browse/SaveSearchButton.tsx`, extend `SaveSearchInput` (after `centerLabel`, line 18):

```ts
  centerLabel?: string | null
  includeListings?: boolean
  includeCompetitors?: boolean
```

In `handleSaveSearch`'s `createAlert({...})` call, add (after `centerLabel`):

```ts
      centerLabel: filters.centerLabel || undefined,
      includeListings: filters.includeListings,
      includeCompetitors: filters.includeCompetitors,
```

In `src/components/browse/BrowsePage.tsx`, in the `<SaveSearchButton filters={{...}} />` props (lines ~315–327), add:

```tsx
                centerLabel: rawFilters.centerLabel || undefined,
                includeListings: rawFilters.showListings,
                includeCompetitors: rawFilters.showCompetitors,
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/FilterBar.tsx src/components/browse/BrowsePage.tsx src/components/browse/SaveSearchButton.tsx
git commit -m "feat(competitors): move layer toggles to filter bar + persist on save"
```

---

### Task 6: Listing-alert gating via a pure matcher

**Files:**
- Create: `src/lib/alert-match.ts`
- Modify: `src/lib/alert-actions.ts`
- Test: `src/__tests__/alert-match.test.ts`

**Interfaces:**
- Consumes: `isWithinRadius` from `@/lib/geo`; `type Alert` (type-only) from `@/db/schema/alerts`.
- Produces: `listingMatchesAlert(alert, listing, locations, now)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/alert-match.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { listingMatchesAlert, type AlertMatchCriteria } from "@/lib/alert-match"

const NOW = new Date("2026-06-29T00:00:00Z")

const baseAlert: AlertMatchCriteria = {
  notifyEnabled: true,
  includeListings: true,
  states: [],
  listingTypes: [],
  minPrice: null,
  maxPrice: null,
  minYearsOpen: null,
  centerLat: null,
  centerLng: null,
  radiusMiles: null,
}
const listing = { type: "suite", state: "AZ", askingPrice: 5_000_000 }

describe("listingMatchesAlert", () => {
  it("matches an unconstrained, enabled alert", () => {
    expect(listingMatchesAlert(baseAlert, listing, [], NOW)).toBe(true)
  })
  it("does not match when notifyEnabled is false", () => {
    expect(listingMatchesAlert({ ...baseAlert, notifyEnabled: false }, listing, [], NOW)).toBe(false)
  })
  it("does not match when includeListings is false (the HS toggle gate)", () => {
    expect(listingMatchesAlert({ ...baseAlert, includeListings: false }, listing, [], NOW)).toBe(false)
  })
  it("filters by state", () => {
    expect(listingMatchesAlert({ ...baseAlert, states: ["TX"] }, listing, [], NOW)).toBe(false)
    expect(listingMatchesAlert({ ...baseAlert, states: ["AZ"] }, listing, [], NOW)).toBe(true)
  })
  it("filters by listing type", () => {
    expect(listingMatchesAlert({ ...baseAlert, listingTypes: ["flagship"] }, listing, [], NOW)).toBe(false)
  })
  it("filters by price range (cents)", () => {
    expect(listingMatchesAlert({ ...baseAlert, minPrice: 6_000_000 }, listing, [], NOW)).toBe(false)
    expect(listingMatchesAlert({ ...baseAlert, maxPrice: 4_000_000 }, listing, [], NOW)).toBe(false)
    expect(listingMatchesAlert({ ...baseAlert, minPrice: 1_000_000, maxPrice: 9_000_000 }, listing, [], NOW)).toBe(true)
  })
  it("requires a location open long enough for minYearsOpen", () => {
    const loc = { latitude: null, longitude: null, territoryLat: null, territoryLng: null, openingDate: new Date("2020-01-01") }
    expect(listingMatchesAlert({ ...baseAlert, minYearsOpen: 3 }, listing, [loc], NOW)).toBe(true)
    expect(listingMatchesAlert({ ...baseAlert, minYearsOpen: 3 }, listing, [], NOW)).toBe(false)
  })
  it("requires a location within radius", () => {
    const near = { latitude: 33.5, longitude: -112.07, territoryLat: null, territoryLng: null, openingDate: null }
    const scope = { centerLat: 33.45, centerLng: -112.07, radiusMiles: 25 }
    expect(listingMatchesAlert({ ...baseAlert, ...scope }, listing, [near], NOW)).toBe(true)
    expect(listingMatchesAlert({ ...baseAlert, ...scope }, listing, [], NOW)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/alert-match.test.ts`
Expected: FAIL — module `@/lib/alert-match` does not exist.

- [ ] **Step 3: Implement the pure matcher**

Create `src/lib/alert-match.ts`:

```ts
import type { Alert } from "@/db/schema/alerts"
import { isWithinRadius } from "./geo"

export type AlertMatchCriteria = Pick<
  Alert,
  | "notifyEnabled" | "includeListings" | "states" | "listingTypes"
  | "minPrice" | "maxPrice" | "minYearsOpen" | "centerLat" | "centerLng" | "radiusMiles"
>

export interface MatchLocation {
  latitude: number | null
  longitude: number | null
  territoryLat: number | null
  territoryLng: number | null
  openingDate: Date | null
}

export interface MatchListingInput {
  type: string
  state: string | null
  askingPrice: number | null
}

/**
 * Pure listing/alert match (ANDs across set criteria). `now` is injected so the
 * minYearsOpen cutoff is testable. `query` and `sort` are intentionally NOT
 * matched.
 */
export function listingMatchesAlert(
  alert: AlertMatchCriteria,
  listing: MatchListingInput,
  locations: MatchLocation[],
  now: Date
): boolean {
  if (alert.notifyEnabled === false) return false
  if (alert.includeListings === false) return false

  if (alert.states && alert.states.length > 0) {
    if (!listing.state || !alert.states.includes(listing.state)) return false
  }
  if (alert.listingTypes && alert.listingTypes.length > 0) {
    if (!alert.listingTypes.includes(listing.type)) return false
  }
  if (alert.minPrice != null && (listing.askingPrice == null || listing.askingPrice < alert.minPrice)) return false
  if (alert.maxPrice != null && (listing.askingPrice == null || listing.askingPrice > alert.maxPrice)) return false

  if (alert.minYearsOpen != null && alert.minYearsOpen > 0) {
    const cutoff = new Date(now)
    cutoff.setFullYear(cutoff.getFullYear() - alert.minYearsOpen)
    const ok = locations.some((l) => l.openingDate != null && l.openingDate <= cutoff)
    if (!ok) return false
  }

  if (alert.centerLat != null && alert.centerLng != null && alert.radiusMiles != null) {
    const ok = locations.some((l) => {
      const lat = l.latitude ?? l.territoryLat
      const lng = l.longitude ?? l.territoryLng
      return lat != null && lng != null &&
        isWithinRadius(alert.centerLat!, alert.centerLng!, lat, lng, alert.radiusMiles!)
    })
    if (!ok) return false
  }
  return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/alert-match.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the matcher in `triggerAlertMatching`**

In `src/lib/alert-actions.ts`: replace the `import { isWithinRadius } from "@/lib/geo"` line with `import { listingMatchesAlert } from "@/lib/alert-match"`. Replace the `const matchingAlerts = allAlerts.filter(({ alert }) => { ... })` block (lines ~182–215) with:

```ts
  const now = new Date()
  const matchingAlerts = allAlerts.filter(({ alert }) =>
    listingMatchesAlert(alert, listing, locations, now)
  )
```

(The local `MatchLocation` / `MatchListing` types at the bottom of the file are still used by the `triggerAlertMatching` signature; leave them. `locations` is `listing.locations ?? []` as before.)

- [ ] **Step 6: Type-check and re-run the matcher test**

Run: `npx tsc --noEmit` (expected: no new errors)
Run: `npx vitest run src/__tests__/alert-match.test.ts` (expected: PASS)

- [ ] **Step 7: Commit**

```bash
git add src/lib/alert-match.ts src/lib/alert-actions.ts src/__tests__/alert-match.test.ts
git commit -m "feat(alerts): pure listing matcher gated by includeListings"
```

---

### Task 7: Competitor digest email template

**Files:**
- Modify: `src/lib/email.ts`
- Test: `src/__tests__/competitor-email.test.ts`

**Interfaces:**
- Produces (used by Task 8): `CompetitorAlertData`, `buildCompetitorAlertEmail(data)`, `sendCompetitorAlertEmail(data)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/competitor-email.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildCompetitorAlertEmail } from "@/lib/email"

const data = {
  buyerEmail: "b@example.com",
  buyerName: "Pat",
  searchName: "Phoenix metro",
  searchUrl: "https://x/browse?centerLat=33",
  competitors: [
    { brandName: "European Wax Center", city: "Tempe", state: "AZ", nearestHsName: "Watermark", nearestHsMiles: 2.3, mapsUrl: "https://maps/x" },
    { brandName: "Sugaring NYC", city: "Mesa", state: "AZ", nearestHsName: null, nearestHsMiles: null, mapsUrl: null },
  ],
}

describe("buildCompetitorAlertEmail", () => {
  it("pluralizes the subject by competitor count", () => {
    expect(buildCompetitorAlertEmail(data).subject).toContain("2 new competitor closures")
    expect(buildCompetitorAlertEmail({ ...data, competitors: [data.competitors[0]] }).subject)
      .toContain("1 new competitor closure near")
  })
  it("renders each competitor, the search name, and the search link", () => {
    const { html } = buildCompetitorAlertEmail(data)
    expect(html).toContain("European Wax Center")
    expect(html).toContain("Sugaring NYC")
    expect(html).toContain("Phoenix metro")
    expect(html).toContain("Tempe, AZ")
    expect(html).toContain("Watermark")
    expect(html).toContain(data.searchUrl)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/competitor-email.test.ts`
Expected: FAIL — `buildCompetitorAlertEmail` is not exported.

- [ ] **Step 3: Add the template + sender**

In `src/lib/email.ts`, add the interface (near the other `*Data` interfaces):

```ts
export interface CompetitorAlertData {
  buyerEmail: string
  buyerName: string
  searchName: string
  searchUrl: string
  competitors: Array<{
    brandName: string
    city: string | null
    state: string | null
    nearestHsName: string | null
    nearestHsMiles: number | null
    mapsUrl: string | null
  }>
}
```

Add the pure builder and the sender at the end of the file:

```ts
/**
 * Build the competitor-closure digest email (pure — exported for tests).
 */
export function buildCompetitorAlertEmail(data: CompetitorAlertData): { subject: string; html: string } {
  const { buyerName, searchName, searchUrl, competitors } = data
  const n = competitors.length
  const subject = `${n} new competitor closure${n !== 1 ? "s" : ""} near your saved search`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"

  const cards = competitors
    .map((c) => {
      const loc = [c.city, c.state].filter(Boolean).join(", ")
      const nearest =
        c.nearestHsName != null && c.nearestHsMiles != null
          ? `<p style="margin: 0 0 4px 0; color: #6b7280;">Nearest Hello Sugar: ${c.nearestHsName} (${c.nearestHsMiles} mi)</p>`
          : ""
      const maps = c.mapsUrl
        ? `<p style="margin: 0;"><a href="${c.mapsUrl}" style="color: #dc2626;">View on Google Maps</a></p>`
        : ""
      return `
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 0 0 12px 0;">
          <p style="margin: 0 0 4px 0;"><strong>${c.brandName}</strong></p>
          ${loc ? `<p style="margin: 0 0 4px 0;">${loc}</p>` : ""}
          ${nearest}
          ${maps}
        </div>`
    })
    .join("")

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #dc2626;">New Competitor Closures Near Your Search</h1>
      <p>Hi ${buyerName},</p>
      <p>${n} new competitor closure${n !== 1 ? "s" : ""} appeared in the area of your saved search <strong>${searchName}</strong>:</p>
      ${cards}
      <p>
        <a href="${searchUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          View your saved search
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 14px;">
        Hello Sugar Marketplace<br />
        <a href="${appUrl}/account/alerts" style="color: #6b7280;">Manage your alerts</a>
      </p>
    </div>
  `

  return { subject, html }
}

/**
 * Send the competitor-closure digest to a saved-search owner.
 */
export async function sendCompetitorAlertEmail(data: CompetitorAlertData) {
  const { subject, html } = buildCompetitorAlertEmail(data)
  return sendEmail({ to: data.buyerEmail, subject, html })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/competitor-email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts src/__tests__/competitor-email.test.ts
git commit -m "feat(competitors): competitor closure digest email template"
```

---

### Task 8: Weekly cron route + schedule

**Files:**
- Create: `src/app/api/cron/competitor-alerts/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `getCompetitorClosures` (Task 3); `filterCompetitorsByScope`, `selectUnloggedCompetitors`, `scopeIsBounded` (Task 2); `getLoggedCompetitorPlaceIds`, `recordCompetitorAlerts` (Task 4); `sendCompetitorAlertEmail` (Task 7); `savedSearchToBrowseParams` from `@/lib/saved-search`.

- [ ] **Step 1: Create the cron route**

Create `src/app/api/cron/competitor-alerts/route.ts`:

```ts
import { NextResponse } from "next/server"
import { db } from "@/db"
import { alerts } from "@/db/schema/alerts"
import { users } from "@/db/schema/auth"
import { eq } from "drizzle-orm"
import { getCompetitorClosures } from "@/lib/competitor-query"
import {
  filterCompetitorsByScope,
  selectUnloggedCompetitors,
  scopeIsBounded,
} from "@/lib/competitor-filter"
import { getLoggedCompetitorPlaceIds, recordCompetitorAlerts } from "@/lib/competitor-alert-log"
import { sendCompetitorAlertEmail } from "@/lib/email"
import { savedSearchToBrowseParams } from "@/lib/saved-search"

export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized invocations
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // The closure set is small — fetch once, filter per saved search in memory.
  const allCompetitors = await getCompetitorClosures()
  const rows = await db
    .select({ alert: alerts, user: users })
    .from(alerts)
    .innerJoin(users, eq(alerts.userId, users.id))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"
  let processed = 0
  let emailed = 0
  let errors = 0

  for (const { alert, user } of rows) {
    if (!alert.notifyEnabled || !alert.includeCompetitors) continue
    if (!user.email) continue
    const scope = {
      centerLat: alert.centerLat,
      centerLng: alert.centerLng,
      radiusMiles: alert.radiusMiles,
      states: alert.states ?? [],
    }
    if (!scopeIsBounded(scope)) continue // unscoped search → would match every closure
    processed++

    try {
      const inScope = filterCompetitorsByScope(allCompetitors, scope)
      const logged = await getLoggedCompetitorPlaceIds(alert.id)
      const fresh = selectUnloggedCompetitors(inScope, logged)
      if (fresh.length === 0) continue

      const res = await sendCompetitorAlertEmail({
        buyerEmail: user.email,
        buyerName: user.name || "Hello Sugar Buyer",
        searchName: alert.name || "your saved search",
        searchUrl: `${appUrl}/browse?${savedSearchToBrowseParams(alert)}`,
        competitors: fresh.map((c) => ({
          brandName: c.brandName,
          city: c.city,
          state: c.state,
          nearestHsName: c.nearestHsName,
          nearestHsMiles: c.nearestHsMiles,
          mapsUrl: c.mapsUrl,
        })),
      })

      // Record only after a successful send, so a failed/skipped send retries
      // next week rather than being silently marked as handled.
      if (res.success) {
        await recordCompetitorAlerts(alert.id, fresh.map((c) => c.googlePlaceId))
        emailed++
      }
    } catch (err) {
      console.error(`[competitor-alerts] alert ${alert.id} failed`, err)
      errors++
    }
  }

  return NextResponse.json({ success: true, processed, emailed, errors })
}
```

- [ ] **Step 2: Register the weekly schedule**

In `vercel.json`, add an entry to the existing `crons` array:

```json
  "crons": [
    {
      "path": "/api/cron/reminders",
      "schedule": "0 9 * * *"
    },
    {
      "path": "/api/cron/sync-owner-directory",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/cron/competitor-alerts",
      "schedule": "0 3 * * 2"
    }
  ]
```

- [ ] **Step 3: Type-check and run the full suite**

Run: `npx tsc --noEmit` (expected: no new errors)
Run: `npx vitest run` (expected: all tests pass — existing plus competitor-filter, alert-match, competitor-email)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/competitor-alerts/route.ts vercel.json
git commit -m "feat(competitors): weekly cron emailing new competitor closures"
```

---

## Controller finalization (after all tasks)

- **Apply schema to Neon:** run `npx drizzle-kit push` (with the user) to create `alerts.include_listings`, `alerts.include_competitors`, and the `competitor_alert_log` table. Additive only; existing alert rows backfill to `include_*` = true.
- **Manual smoke (deferred — needs the dev server, which the user starts):** save a search with the competitor toggle on and confirm a `competitor_alert_log` baseline is written (no email); confirm competitors on the map/list narrow to the radius+state; confirm the cron route returns 401 without the secret and a summary with it.

## Self-Review

**Spec coverage:**
- Competitors respect radius + state → Tasks 2 (pure filter) + 3 (query/page wiring). ✓
- Toggles moved to filter bar (nuqs, default true; mobile via drawer→FilterBar) → Task 5. ✓
- Toggles persisted onto the saved search → Tasks 4 (server columns/schema) + 5 (client pass-through). ✓
- HS toggle gates listing alerts → Task 6 (`includeListings` in `listingMatchesAlert`). ✓
- New table + columns, push-managed, app-owned ledger → Task 1. ✓
- Weekly cron, app-side, decoupled, auth, skip-unscoped, digest, idempotent log-after-send → Task 8. ✓
- Baseline seeding on create + competitor-toggle off→on → Task 4. ✓
- New competitor digest email template → Task 7. ✓
- Error resilience (empty competitor table → []; per-alert try/catch) → Tasks 3 + 8. ✓
- Recipient = saved-search owner; cron schedule `0 3 * * 2` → Task 8. ✓
- Tests on pure logic per repo convention → Tasks 2, 6, 7. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code/test step has full content. ✓

**Type consistency:** `CompetitorScope` (Task 2) consumed unchanged by Tasks 3/4/8; `getCompetitorClosures(scope?)` signature consistent across Tasks 3/4/8; `getLoggedCompetitorPlaceIds`/`recordCompetitorAlerts` defined in Task 4 and used in Task 8; `AlertMatchCriteria`/`listingMatchesAlert` defined in Task 6 and used there; `CompetitorAlertData`/`buildCompetitorAlertEmail`/`sendCompetitorAlertEmail` defined in Task 7 and used in Task 8; `includeListings`/`includeCompetitors` columns (Task 1) used by Tasks 4/5/6; `showListings`/`showCompetitors` nuqs params (Task 5) used in BrowsePage + SaveSearchButton. ✓
