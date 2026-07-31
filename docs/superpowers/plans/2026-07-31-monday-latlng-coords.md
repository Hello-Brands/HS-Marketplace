# Monday Lat/Lng Coordinate Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the BigQuery Monday view (`snowflake_data.vw_custom_monday_data_raw`) the absolute source of truth for HS location coordinates on the `/browse` map, with MapTiler geocoding as fallback only.

**Architecture:** One new uncached BigQuery query returns `location number → {lat, lng}`. The existing owner-directory sync applies those coords to `owner_locations` (direct number join, overwriting every sync) and bridges them onto confirmed `listing_locations` (bqLocationName → owner row → number). The admin confirm-mapping action applies coords immediately on confirm. Spec: `docs/superpowers/specs/2026-07-31-monday-latlng-source-of-truth-design.md`.

**Tech Stack:** Next.js App Router, Drizzle ORM on Neon HTTP, @google-cloud/bigquery, vitest.

## Global Constraints

- Branch: `feature/monday-latlng-coords` (already created from `origin/main`); one PR against `origin/main`.
- Neon HTTP driver has **no** `db.transaction` — atomic multi-writes use `db.batch([...])`.
- Migrations are **hand-authored SQL** (drizzle-kit generate is broken by snapshot drift; `db:push` is guarded). Next free number: `0008`.
- Gates: `npx tsc --noEmit` (typecheck) and `npx vitest run <file>` per task; full `npm test` at the end. Do NOT run `next build` (Windows .next lock w/ dev server; CI builds). `npm run lint` is broken pre-existing — skip it.
- Never import `"server-only"` into anything a `tsx` script would load (no scripts touch these modules in this plan).
- New BQ query must NOT use `unstable_cache` (a stale/empty coords map must never poison a sync).
- Every commit message ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Windows shell caveat: prefer the Bash tool with forward-slash paths for git; file paths in code use `@/` aliases.

---

### Task 1: Migration 0008 + `coord_source` column on owner_locations

**Files:**
- Create: `drizzle/0008_owner_locations_coord_source.sql`
- Modify: `src/db/schema/ownerLocations.ts` (add column after `geocodedAt`, ~line 63)

**Interfaces:**
- Produces: `ownerLocations.coordSource` — nullable `text` column, values `'monday' | 'maptiler' | NULL`. Tasks 4–5 read/write it.

- [ ] **Step 1: Write the migration SQL**

`drizzle/0008_owner_locations_coord_source.sql` (mirror the single-statement style of `0007_monitored_brands_nullable_count.sql`):

```sql
ALTER TABLE "owner_locations" ADD COLUMN "coord_source" text;
```

- [ ] **Step 2: Add the column to the Drizzle schema**

In `src/db/schema/ownerLocations.ts`, directly below `geocodedAt: timestamp("geocoded_at"),`:

```ts
    // Which system produced latitude/longitude: 'monday' (BigQuery Monday
    // view — the source of truth) or 'maptiler' (geocoder fallback).
    // NULL = geocoded before this column existed (unknown provenance).
    coordSource: text("coord_source"),
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (column is additive; nothing reads it yet).

- [ ] **Step 4: Commit**

```bash
git add drizzle/0008_owner_locations_coord_source.sql src/db/schema/ownerLocations.ts
git commit -m "feat(db): add owner_locations.coord_source (migration 0008)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: applying 0008 to prod happens at rollout (see Task 7), not now.

---

### Task 2: BigQuery Monday-coords query + pure converter

**Files:**
- Modify: `src/lib/bigquery/queries.ts` (append a new section after `listLocationNames`, ~line 187)
- Test: `src/__tests__/bigquery/queries.test.ts` (append describes; file already mocks `runQuery` and `unstable_cache`)

**Interfaces:**
- Consumes: existing `runQuery<T>(sql): Promise<T[] | null>` from `@/lib/bigquery/client`; existing `Numeric` type in the same file.
- Produces:
  - `export type MondayCoords = Map<string, { lat: number; lng: number }>` (key = trimmed BLVD location number)
  - `export function rowsToMondayCoords(rows: MondayCoordsRow[]): MondayCoords` (pure, for tests)
  - `export async function getMondayCoordsByLocationNumber(): Promise<MondayCoords | null>` — `null` = query failed/no creds. **Uncached.**

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/bigquery/queries.test.ts` (add `rowsToMondayCoords`, `getMondayCoordsByLocationNumber` to the existing import from `@/lib/bigquery/queries`):

```ts
describe("rowsToMondayCoords", () => {
  it("maps trimmed numbers to finite lat/lng", () => {
    const map = rowsToMondayCoords([
      { num: " 284 ", lat: "40.691574", lng: "-73.988771" },
      { num: "057", lat: 35.595646, lng: -82.556625 },
    ])
    expect(map.get("284")).toEqual({ lat: 40.691574, lng: -73.988771 })
    expect(map.get("057")).toEqual({ lat: 35.595646, lng: -82.556625 })
  })

  it("skips null/empty numbers and keeps the first row on duplicates", () => {
    const map = rowsToMondayCoords([
      { num: null, lat: 1, lng: 2 },
      { num: "  ", lat: 1, lng: 2 },
      { num: "100", lat: 39.889683, lng: -74.925992 },
      { num: "100", lat: 0, lng: 0 },
    ])
    expect(map.size).toBe(1)
    expect(map.get("100")).toEqual({ lat: 39.889683, lng: -74.925992 })
  })

  it("drops rows whose coords do not coerce to finite numbers", () => {
    const map = rowsToMondayCoords([
      { num: "1", lat: null, lng: -74 },
      { num: "2", lat: "abc", lng: -74 },
      { num: "3", lat: { toString: () => "41.5" }, lng: { toString: () => "-87.6" } },
    ])
    expect(map.size).toBe(1)
    expect(map.get("3")).toEqual({ lat: 41.5, lng: -87.6 })
  })
})

describe("getMondayCoordsByLocationNumber", () => {
  beforeEach(() => runQuery.mockReset())

  it("returns null when the query fails (never a partial/empty map)", async () => {
    runQuery.mockResolvedValue(null)
    expect(await getMondayCoordsByLocationNumber()).toBeNull()
  })

  it("returns the converted map on success", async () => {
    runQuery.mockResolvedValue([{ num: "284", lat: "40.69", lng: "-73.98" }])
    const map = await getMondayCoordsByLocationNumber()
    expect(map?.get("284")).toEqual({ lat: 40.69, lng: -73.98 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/bigquery/queries.test.ts`
Expected: FAIL — `rowsToMondayCoords` is not exported.

- [ ] **Step 3: Implement in `src/lib/bigquery/queries.ts`**

Append after `listLocationNames` (before the Reviews section):

```ts
// ---- Monday coordinates (source of truth for map pins) --------------------

/**
 * Per-location coordinates maintained in the Monday board. Keyed by the
 * trimmed BLVD location number — the view's Name/BLVD Location Name columns
 * are entirely NULL, so the number is the only usable join key.
 *
 * The source table is a partitioned snapshot loaded from Snowflake; GROUP BY
 * dedupes defensively in case it ever returns more than one snapshot.
 */
const MONDAY_COORDS_SQL = `
  SELECT TRIM(\`BLVD Location #\`) AS num,
         ANY_VALUE(CAST(Latitude AS FLOAT64))  AS lat,
         ANY_VALUE(CAST(Longitude AS FLOAT64)) AS lng
  FROM \`even-affinity-388602.snowflake_data.vw_custom_monday_data_raw\`
  WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL
    AND TRIM(\`BLVD Location #\`) != ''
  GROUP BY num`

type MondayCoordsRow = { num: string | null; lat: Numeric; lng: Numeric }
export type MondayCoords = Map<string, { lat: number; lng: number }>

/** Coerce to a finite number or null — unlike toNumber, never fabricates 0. */
function toFiniteNumber(v: Numeric): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === "number" ? v : Number(v.toString())
  return Number.isFinite(n) ? n : null
}

/** Pure: rows → number-keyed coords map (first row wins on duplicates). Exported for tests. */
export function rowsToMondayCoords(rows: MondayCoordsRow[]): MondayCoords {
  const map: MondayCoords = new Map()
  for (const r of rows) {
    const num = r.num?.trim()
    if (!num || map.has(num)) continue
    const lat = toFiniteNumber(r.lat)
    const lng = toFiniteNumber(r.lng)
    if (lat === null || lng === null) continue
    map.set(num, { lat, lng })
  }
  return map
}

/**
 * Coordinates from the Monday view, or null when the query fails.
 * Deliberately UNCACHED: only sync/confirm paths call this, and a stale or
 * empty cached map must never poison a sync (cf. the unstable_cache
 * empty-result incident in the KPI queries above).
 */
export async function getMondayCoordsByLocationNumber(): Promise<MondayCoords | null> {
  const rows = await runQuery<MondayCoordsRow>(MONDAY_COORDS_SQL)
  if (rows === null) return null
  return rowsToMondayCoords(rows)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/bigquery/queries.test.ts` — Expected: PASS
Run: `npx tsc --noEmit` — Expected: clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/bigquery/queries.ts src/__tests__/bigquery/queries.test.ts
git commit -m "feat(bigquery): Monday coords query keyed by BLVD location number

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure per-row coords resolver

**Files:**
- Create: `src/lib/owner-directory/monday-coords.ts`
- Test: `src/__tests__/owner-directory/monday-coords.test.ts`

**Interfaces:**
- Consumes: `MondayCoords` type from `@/lib/bigquery/queries` (Task 2).
- Produces:
  - `export type CoordFields = { latitude: number | null; longitude: number | null; geocodedAt: Date | null; coordSource: string | null }`
  - `export function resolveOwnerRowCoords(blvdLocationNumber: string | null, prior: CoordFields | null, coords: MondayCoords | null, now: Date): CoordFields` — pure. Task 4 calls it per synced row.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/owner-directory/monday-coords.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { resolveOwnerRowCoords } from "@/lib/owner-directory/monday-coords"

const NOW = new Date("2026-07-31T12:00:00Z")
const coords = new Map([["284", { lat: 40.691574, lng: -73.988771 }]])

describe("resolveOwnerRowCoords", () => {
  it("applies Monday coords for a covered number, overwriting a differing prior", () => {
    const prior = {
      latitude: 1, longitude: 2,
      geocodedAt: new Date("2025-01-01"), coordSource: "maptiler",
    }
    expect(resolveOwnerRowCoords("284", prior, coords, NOW)).toEqual({
      latitude: 40.691574, longitude: -73.988771, geocodedAt: NOW, coordSource: "monday",
    })
  })

  it("trims the incoming number before lookup", () => {
    expect(resolveOwnerRowCoords(" 284 ", null, coords, NOW).coordSource).toBe("monday")
  })

  it("preserves prior coords (and their source) for an uncovered number", () => {
    const prior = {
      latitude: 35.6, longitude: -82.5,
      geocodedAt: new Date("2025-01-01"), coordSource: "maptiler",
    }
    expect(resolveOwnerRowCoords("999", prior, coords, NOW)).toEqual(prior)
  })

  it("returns all-null for an uncovered row with no prior", () => {
    expect(resolveOwnerRowCoords(null, null, coords, NOW)).toEqual({
      latitude: null, longitude: null, geocodedAt: null, coordSource: null,
    })
  })

  it("falls back to prior when the coords map is null (BigQuery failure)", () => {
    const prior = {
      latitude: 35.6, longitude: -82.5, geocodedAt: null, coordSource: null,
    }
    expect(resolveOwnerRowCoords("284", prior, null, NOW)).toEqual(prior)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/owner-directory/monday-coords.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/owner-directory/monday-coords.ts`**

```ts
import "server-only"
import type { MondayCoords } from "@/lib/bigquery/queries"

export type CoordFields = {
  latitude: number | null
  longitude: number | null
  geocodedAt: Date | null
  coordSource: string | null
}

/**
 * Decide a synced owner row's stored coordinates.
 *
 * Monday is the absolute source of truth: a number covered by the view gets
 * Monday's coords stamped on EVERY sync, replacing anything prior (even a
 * differing MapTiler geocode). Uncovered rows keep their prior coords —
 * including provenance — and the MapTiler backfill later fills NULLs.
 */
export function resolveOwnerRowCoords(
  blvdLocationNumber: string | null,
  prior: CoordFields | null,
  coords: MondayCoords | null,
  now: Date
): CoordFields {
  const num = blvdLocationNumber?.trim()
  const hit = num && coords ? coords.get(num) : undefined
  if (hit) {
    return { latitude: hit.lat, longitude: hit.lng, geocodedAt: now, coordSource: "monday" }
  }
  return {
    latitude: prior?.latitude ?? null,
    longitude: prior?.longitude ?? null,
    geocodedAt: prior?.geocodedAt ?? null,
    coordSource: prior?.coordSource ?? null,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/owner-directory/monday-coords.test.ts` — Expected: PASS
Run: `npx tsc --noEmit` — Expected: clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/owner-directory/monday-coords.ts src/__tests__/owner-directory/monday-coords.test.ts
git commit -m "feat(owner-directory): pure Monday-coords row resolver

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Apply Monday coords in the owner-directory sync

**Files:**
- Modify: `src/lib/owner-directory/sync.ts`

**Interfaces:**
- Consumes: `getMondayCoordsByLocationNumber` (Task 2), `resolveOwnerRowCoords` (Task 3), `ownerLocations.coordSource` (Task 1).
- Produces: `SyncResult` gains `mondayCoordsApplied: number`. (Cron route spreads `...result` into JSON and admin action passes it through — **no consumer changes needed**; the mocked-sync tests in `src/__tests__/cron-sync-owner-directory.test.ts` and `owner-directory/actions.test.ts` are unaffected.)

This task is wiring; its logic lives in the Task 3 pure function (already tested). The full suite is the regression gate.

- [ ] **Step 1: Add imports and extend `SyncResult`**

In `src/lib/owner-directory/sync.ts`, extend the imports:

```ts
import { listLocationNames, getMondayCoordsByLocationNumber } from "@/lib/bigquery/queries"
import { resolveOwnerRowCoords } from "./monday-coords"
```

In `SyncResult` (after `geocoded: number`):

```ts
  mondayCoordsApplied: number
```

- [ ] **Step 2: Fetch the coords map alongside the directory**

Replace the sequential fetches at the top of `syncOwnerLocations` (`const rows = await fetchOwnerDirectory()` ... `const bqNames = await listLocationNames()`) with:

```ts
  const [rows, bqNames, mondayCoords] = await Promise.all([
    fetchOwnerDirectory(),
    listLocationNames(),
    getMondayCoordsByLocationNumber(),
  ])
  if (rows === null) {
    throw new Error(
      "owner-directory sync: BigQuery returned no result (check GCP_SERVICE_ACCOUNT_JSON / BIGQUERY_PROJECT_ID / view permissions)"
    )
  }
  if (mondayCoords === null) {
    // Sync must not block on the coords source; rows behave as "not covered".
    console.warn("owner-directory sync: Monday coords unavailable — coords not applied this run")
  }
  const bqNamesList = bqNames ?? []
```

- [ ] **Step 3: Preserve `coordSource` in the existing-rows select**

Add to the `.select({...})` block that builds `existing` (alongside `latitude`, `longitude`, `geocodedAt`):

```ts
      coordSource: ownerLocations.coordSource,
```

- [ ] **Step 4: Resolve coords per row in the `values` build**

Add a counter before the `deduped.map(...)`:

```ts
  let mondayCoordsApplied = 0
```

In the returned object of `values = deduped.map((r) => { ... })`, replace the three coord lines

```ts
      // Preserve geocoded coords across the full-refresh (like resolvedBqLocationName).
      latitude: prior?.latitude ?? null,
      longitude: prior?.longitude ?? null,
      geocodedAt: prior?.geocodedAt ?? null,
```

with:

```ts
      // Monday view coords are the source of truth (stamped every sync);
      // uncovered rows preserve prior coords like resolvedBqLocationName.
      ...(() => {
        const coordFields = resolveOwnerRowCoords(
          r.blvd_location_number || null,
          prior ?? null,
          mondayCoords,
          now
        )
        if (coordFields.coordSource === "monday") mondayCoordsApplied++
        return coordFields
      })(),
```

(`CoordFields` keys — `latitude`, `longitude`, `geocodedAt`, `coordSource` — spread directly into the insert value; `prior` is structurally a `CoordFields` since Step 3.)

- [ ] **Step 5: Carry `coord_source` through the upsert and the MapTiler backfill**

In `.onConflictDoUpdate({ set: {...} })`, after `geocodedAt: sql\`excluded.geocoded_at\`,`:

```ts
              coordSource: sql`excluded.coord_source`,
```

In the geocode backfill loop, extend the `.set(...)`:

```ts
            .set({ latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date(), coordSource: "maptiler" })
```

- [ ] **Step 6: Return the counter**

Add to the returned `SyncResult` object:

```ts
    mondayCoordsApplied,
```

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit` — Expected: clean
Run: `npm test` — Expected: PASS (sync consumers mock `syncOwnerLocations`, so only compile-level impact)

- [ ] **Step 8: Commit**

```bash
git add src/lib/owner-directory/sync.ts
git commit -m "feat(owner-directory): stamp Monday coords on every sync (source of truth)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Bridge Monday coords onto confirmed listing locations

**Files:**
- Modify: `src/lib/owner-directory/monday-coords.ts` (add bridge + shared name→coords helper)
- Modify: `src/lib/owner-directory/sync.ts` (call bridge, add counter)
- Modify: `test/helpers/drizzle-mock.ts` (add `"innerJoin"` to `CHAINED_METHODS`)
- Test: `src/__tests__/owner-directory/monday-coords.test.ts` (extend)

**Interfaces:**
- Consumes: `listingLocations` (`@/db/schema/listings` — has `geocodeSource`), `ownerLocations`, `db` from `@/db`, `MondayCoords` (Task 2).
- Produces:
  - `export async function applyMondayCoordsToListings(coords: MondayCoords, now: Date): Promise<number>` — returns rows updated; Task 4's sync calls it.
  - `export async function mondayCoordsForBqName(bqName: string, coords: MondayCoords): Promise<{ lat: number; lng: number } | null>` — Task 6's confirm hook calls it.
  - `SyncResult` gains `listingCoordsApplied: number`.

- [ ] **Step 1: Add `"innerJoin"` to the drizzle mock**

In `test/helpers/drizzle-mock.ts`, add `"innerJoin",` to `CHAINED_METHODS` (after `"leftJoin",`).

- [ ] **Step 2: Write the failing tests**

Append to `src/__tests__/owner-directory/monday-coords.test.ts`. Add mocks ABOVE the existing import of the module under test (vi.mock calls hoist; the static import then sees the mocked `@/db`):

```ts
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

const select = vi.fn()
const update = vi.fn()
const batch = vi.fn(async () => [])
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    update: (...a: unknown[]) => update(...a),
    batch: (...a: unknown[]) => batch(...a),
  },
}))

import {
  resolveOwnerRowCoords,
  applyMondayCoordsToListings,
  mondayCoordsForBqName,
} from "@/lib/owner-directory/monday-coords"
```

(Then, inside the file, the new describes; `beforeEach` resets `select`, `update`, `batch`.)

```ts
describe("applyMondayCoordsToListings", () => {
  beforeEach(() => {
    select.mockReset()
    update.mockReset()
    batch.mockReset().mockResolvedValue([])
  })

  const coordsMap = new Map([["284", { lat: 40.69, lng: -73.98 }]])

  it("updates each confirmed listing location whose bridged number has coords", async () => {
    // ll-1 appears twice (multi-owner rows sharing the resolved name); ll-2's
    // number is uncovered; ll-3's owner row has no number.
    select.mockReturnValue(
      builder([
        { id: "ll-1", num: "284" },
        { id: "ll-1", num: "284" },
        { id: "ll-2", num: "999" },
        { id: "ll-3", num: null },
      ])
    )
    const updateBuilders: ChainedBuilder[] = []
    update.mockImplementation(() => {
      const b = builder(undefined)
      updateBuilders.push(b)
      return b
    })

    const n = await applyMondayCoordsToListings(coordsMap, new Date("2026-07-31T12:00:00Z"))

    expect(n).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateBuilders[0].calls.set[0][0]).toMatchObject({
      latitude: 40.69,
      longitude: -73.98,
      geocodeSource: "monday",
    })
    expect(batch).toHaveBeenCalledTimes(1)
  })

  it("is a no-op (no batch call) when nothing matches", async () => {
    select.mockReturnValue(builder([{ id: "ll-2", num: "999" }]))
    expect(await applyMondayCoordsToListings(coordsMap, new Date())).toBe(0)
    expect(batch).not.toHaveBeenCalled()
  })
})

describe("mondayCoordsForBqName", () => {
  beforeEach(() => select.mockReset())

  it("returns the first owner row's covered coords (trimming the number)", async () => {
    select.mockReturnValue(builder([{ num: null }, { num: " 284 " }]))
    expect(await mondayCoordsForBqName("Sugar House", new Map([["284", { lat: 1, lng: 2 }]])))
      .toEqual({ lat: 1, lng: 2 })
  })

  it("returns null when no owner row's number is covered", async () => {
    select.mockReturnValue(builder([{ num: "999" }]))
    expect(await mondayCoordsForBqName("Sugar House", new Map())).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/owner-directory/monday-coords.test.ts`
Expected: FAIL — `applyMondayCoordsToListings` / `mondayCoordsForBqName` not exported. (The existing `resolveOwnerRowCoords` describes must still PASS with the new `@/db` mock in place — it never touches db.)

- [ ] **Step 4: Implement both functions in `src/lib/owner-directory/monday-coords.ts`**

Extend the imports:

```ts
import { and, eq, isNotNull } from "drizzle-orm"
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { ownerLocations } from "@/db/schema/ownerLocations"
```

Append:

```ts
/**
 * Stamp Monday coords onto confirmed salon listing locations via the
 * name→number bridge: listing_locations.bq_location_name =
 * owner_locations.resolved_bq_location_name → blvd_location_number → coords.
 * Multi-owner rows share the same number, so the first covered hit wins.
 * Returns the number of listing locations updated.
 */
export async function applyMondayCoordsToListings(
  coords: MondayCoords,
  now: Date
): Promise<number> {
  const rows = await db
    .select({ id: listingLocations.id, num: ownerLocations.blvdLocationNumber })
    .from(listingLocations)
    .innerJoin(
      ownerLocations,
      eq(ownerLocations.resolvedBqLocationName, listingLocations.bqLocationName)
    )
    .where(
      and(
        eq(listingLocations.locationType, "salon"),
        eq(listingLocations.dataMappingStatus, "confirmed"),
        isNotNull(listingLocations.bqLocationName),
        isNotNull(ownerLocations.blvdLocationNumber)
      )
    )

  const byId = new Map<string, { lat: number; lng: number }>()
  for (const r of rows) {
    if (byId.has(r.id)) continue
    const hit = r.num ? coords.get(r.num.trim()) : undefined
    if (hit) byId.set(r.id, hit)
  }
  if (byId.size === 0) return 0

  const updates = [...byId.entries()].map(([id, c]) =>
    db
      .update(listingLocations)
      .set({ latitude: c.lat, longitude: c.lng, geocodedAt: now, geocodeSource: "monday" })
      .where(eq(listingLocations.id, id))
  )
  // neon-http: one batch = one transaction (no db.transaction on this driver)
  await db.batch(updates as [(typeof updates)[number], ...typeof updates])
  return byId.size
}

/**
 * Monday coords for a single confirmed BigQuery LOCATION_NAME, via any owner
 * row carrying that resolved name. Null when no covered number exists.
 */
export async function mondayCoordsForBqName(
  bqName: string,
  coords: MondayCoords
): Promise<{ lat: number; lng: number } | null> {
  const rows = await db
    .select({ num: ownerLocations.blvdLocationNumber })
    .from(ownerLocations)
    .where(
      and(
        eq(ownerLocations.resolvedBqLocationName, bqName),
        isNotNull(ownerLocations.blvdLocationNumber)
      )
    )
  for (const r of rows) {
    const hit = r.num ? coords.get(r.num.trim()) : undefined
    if (hit) return hit
  }
  return null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/owner-directory/monday-coords.test.ts`
Expected: PASS

- [ ] **Step 6: Wire the bridge into the sync**

In `src/lib/owner-directory/sync.ts`:

Import: change the `./monday-coords` import to include the bridge:

```ts
import { resolveOwnerRowCoords, applyMondayCoordsToListings } from "./monday-coords"
```

`SyncResult`: add after `mondayCoordsApplied`:

```ts
  listingCoordsApplied: number
```

After the `db.batch` upsert/delete block and BEFORE the geocode backfill, insert:

```ts
  // Bridge Monday coords onto confirmed listing locations. Best-effort like
  // the geocode backfill: the directory upsert above is already committed.
  let listingCoordsApplied = 0
  if (mondayCoords) {
    try {
      listingCoordsApplied = await applyMondayCoordsToListings(mondayCoords, now)
    } catch (err) {
      console.error(
        "owner-directory sync: listing coords bridge failed (directory sync already committed)",
        err
      )
    }
  }
```

Add `listingCoordsApplied,` to the returned object.

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit` — Expected: clean
Run: `npm test` — Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/owner-directory/monday-coords.ts src/lib/owner-directory/sync.ts test/helpers/drizzle-mock.ts src/__tests__/owner-directory/monday-coords.test.ts
git commit -m "feat(owner-directory): bridge Monday coords onto confirmed listing locations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Apply Monday coords on admin mapping confirm

**Files:**
- Modify: `src/lib/data/mapping-actions.ts`
- Test: Create `src/__tests__/data/mapping-actions.test.ts`

**Interfaces:**
- Consumes: `getMondayCoordsByLocationNumber` (Task 2), `mondayCoordsForBqName` (Task 5). `setLocationMapping`'s public signature is unchanged.

- [ ] **Step 1: Write the failing tests**

`src/__tests__/data/mapping-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const auth = vi.fn()
vi.mock("@/auth", () => ({ auth }))

const update = vi.fn()
vi.mock("@/db", () => ({ db: { update: (...a: unknown[]) => update(...a) } }))

const getMondayCoordsByLocationNumber = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({ getMondayCoordsByLocationNumber }))

const mondayCoordsForBqName = vi.fn()
vi.mock("@/lib/owner-directory/monday-coords", () => ({ mondayCoordsForBqName }))

import { setLocationMapping } from "@/lib/data/mapping-actions"

describe("setLocationMapping", () => {
  let updateBuilder: ChainedBuilder

  beforeEach(() => {
    auth.mockReset().mockResolvedValue({ user: { role: "admin" } })
    update.mockReset()
    updateBuilder = builder(undefined)
    update.mockReturnValue(updateBuilder)
    getMondayCoordsByLocationNumber.mockReset()
    mondayCoordsForBqName.mockReset()
  })

  it("rejects non-admins without touching the DB", async () => {
    auth.mockResolvedValue({ user: { role: "user" } })
    expect(await setLocationMapping("ll-1", { bqLocationName: "X", status: "confirmed" }))
      .toEqual({ ok: false, error: "Admin access required" })
    expect(update).not.toHaveBeenCalled()
  })

  it("still requires a location name to confirm", async () => {
    expect(await setLocationMapping("ll-1", { bqLocationName: null, status: "confirmed" }))
      .toEqual({ ok: false, error: "A location is required to confirm." })
    expect(update).not.toHaveBeenCalled()
  })

  it("stamps Monday coords when confirming a covered location", async () => {
    const coords = new Map([["284", { lat: 40.69, lng: -73.98 }]])
    getMondayCoordsByLocationNumber.mockResolvedValue(coords)
    mondayCoordsForBqName.mockResolvedValue({ lat: 40.69, lng: -73.98 })

    expect(await setLocationMapping("ll-1", { bqLocationName: "Sugar House", status: "confirmed" }))
      .toEqual({ ok: true })
    expect(mondayCoordsForBqName).toHaveBeenCalledWith("Sugar House", coords)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({
      bqLocationName: "Sugar House",
      dataMappingStatus: "confirmed",
      latitude: 40.69,
      longitude: -73.98,
      geocodeSource: "monday",
    })
  })

  it("confirms without coords when the coords fetch fails", async () => {
    getMondayCoordsByLocationNumber.mockResolvedValue(null)
    expect(await setLocationMapping("ll-1", { bqLocationName: "Sugar House", status: "confirmed" }))
      .toEqual({ ok: true })
    expect(mondayCoordsForBqName).not.toHaveBeenCalled()
    const set = updateBuilder.calls.set[0][0] as Record<string, unknown>
    expect(set).toMatchObject({ bqLocationName: "Sugar House", dataMappingStatus: "confirmed" })
    expect(set).not.toHaveProperty("latitude")
  })

  it("confirms without coords when the lookup throws", async () => {
    getMondayCoordsByLocationNumber.mockRejectedValue(new Error("bq down"))
    expect(await setLocationMapping("ll-1", { bqLocationName: "Sugar House", status: "confirmed" }))
      .toEqual({ ok: true })
    expect((updateBuilder.calls.set[0][0] as Record<string, unknown>)).not.toHaveProperty("latitude")
  })

  it("never queries BigQuery for not_connected", async () => {
    expect(await setLocationMapping("ll-1", { bqLocationName: null, status: "not_connected" }))
      .toEqual({ ok: true })
    expect(getMondayCoordsByLocationNumber).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/data/mapping-actions.test.ts`
Expected: FAIL — coords cases fail (current code never sets latitude); auth/validation cases may already pass.

- [ ] **Step 3: Implement in `src/lib/data/mapping-actions.ts`**

Replace the file body (signature and auth/validation behavior unchanged):

```ts
"use server"

import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { getMondayCoordsByLocationNumber } from "@/lib/bigquery/queries"
import { mondayCoordsForBqName } from "@/lib/owner-directory/monday-coords"

export async function setLocationMapping(
  locationId: string,
  input: { bqLocationName: string | null; status: "confirmed" | "not_connected" }
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return { ok: false, error: "Admin access required" }
  }
  if (input.status === "confirmed" && !input.bqLocationName) {
    return { ok: false, error: "A location is required to confirm." }
  }

  // Monday is the coordinate source of truth: stamp coords the moment a
  // mapping is confirmed rather than waiting for the next directory sync.
  // Best-effort — a BigQuery failure degrades to confirming without coords.
  let coordFields: {
    latitude?: number
    longitude?: number
    geocodedAt?: Date
    geocodeSource?: string
  } = {}
  if (input.status === "confirmed" && input.bqLocationName) {
    try {
      const coords = await getMondayCoordsByLocationNumber()
      const hit = coords ? await mondayCoordsForBqName(input.bqLocationName, coords) : null
      if (hit) {
        coordFields = {
          latitude: hit.lat,
          longitude: hit.lng,
          geocodedAt: new Date(),
          geocodeSource: "monday",
        }
      }
    } catch (err) {
      console.warn("[data-mapping] Monday coords lookup failed — mapping saved without coords", err)
    }
  }

  await db
    .update(listingLocations)
    .set({ bqLocationName: input.bqLocationName, dataMappingStatus: input.status, ...coordFields })
    .where(eq(listingLocations.id, locationId))
  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/data/mapping-actions.test.ts` — Expected: PASS
Run: `npx tsc --noEmit` — Expected: clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/mapping-actions.ts src/__tests__/data/mapping-actions.test.ts
git commit -m "feat(data-mapping): stamp Monday coords when a mapping is confirmed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification + PR

**Files:** none new (verification + PR only)

- [ ] **Step 1: Full gates**

Run: `npm test` — Expected: all pass
Run: `npx tsc --noEmit` — Expected: clean
(Skip `npm run lint` — broken pre-existing. Skip local `next build` — CI builds; Windows .next lock.)

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feature/monday-latlng-coords
gh pr create --title "feat: Monday lat/lng as coordinate source of truth for map pins" --body "$(cat <<'EOF'
## Summary
- New BigQuery query reads per-location coords from `snowflake_data.vw_custom_monday_data_raw`, keyed by trimmed `BLVD Location #` (the only non-null key in the view)
- Owner-directory sync stamps Monday coords onto `owner_locations` on every run (absolute source of truth; overwrites prior MapTiler geocodes) and bridges them onto confirmed salon `listing_locations` via resolved-name → location number
- Admin confirm-mapping stamps coords immediately; MapTiler remains the fallback for uncovered rows only
- Migration 0008 adds diagnostic `owner_locations.coord_source` ('monday' | 'maptiler')

Spec: docs/superpowers/specs/2026-07-31-monday-latlng-source-of-truth-design.md

## Rollout (after merge)
1. Apply migration 0008 to prod (`npm run db:migrate` with prod `DATABASE_URL_DIRECT`)
2. Deploy, then trigger one owner-directory sync (admin button or cron) — this is the backfill
3. Verify /browse: previously-ungeocoded dots #045 #218 #241 #015 #259 appear; Royal Oak #127 moves to Monday's (currently wrong) coords — expected until the board is fixed; bad-coords list goes to the data team

## Test plan
- [x] Pure converter + resolver + bridge + confirm-action unit tests (vitest)
- [x] `npx tsc --noEmit`
- [ ] Post-deploy: run sync, spot-check /browse pins

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(If push 403s: `gh auth switch` to `sugarparker` — only that account can push to Hello-Brands.)

- [ ] **Step 3: Report known-bad Monday rows**

Hand the user the list for the data team (from the 2026-07-31 comparison): #127 Royal Oak MI (coords are in Ohio, ~284 km off), #041 Orlando Dr Phillips, #144 Medford MA, #254 Carmel IN (several km off each) — plus the full >500 m disagreement list on request.
