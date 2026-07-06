# Unlisted Hello Sugar Locations — Map Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show open Hello Sugar locations that are not listed for sale as a distinct slate-dot layer on the `/browse` map (map only, hover-only, no navigation), with a collapsible on-map key.

**Architecture:** Geocode the `owner_locations` directory once (new columns + backfill + geocode-on-sync), add a resilient read query that returns open, geocoded, not-currently-listed locations, render them as a third DOM-marker layer in `MapView` following the existing competitor-layer pattern, and replace the top-bar layer chips with a collapsible `MapLegend` (4 swatches / 3 toggles).

**Tech Stack:** Next.js (App Router), TypeScript, Drizzle ORM (Neon HTTP, push-managed), MapTiler SDK, nuqs (URL filter state), Vitest (node env, pure-logic tests only).

## Global Constraints

- **This is NOT the Next.js you know** — read `node_modules/next/dist/docs/` before writing framework code; heed deprecation notices (per `AGENTS.md`).
- **DB is push-managed** — apply schema changes with `npm run db:push` (drizzle-kit), NOT generate/migrate. New columns must be additive and nullable.
- **Test env is `node`-only** — no jsdom/RTL. Unit-test pure functions only (mirror `src/__tests__/competitor-filter.test.ts`). React components and MapTiler rendering are verified by `npx tsc --noEmit` + manual load, never by unit tests.
- **Do NOT run `next build`** on this machine (Windows `.next` lock) and do NOT auto-start the dev server. Per-step gate is `npx tsc --noEmit`; `npm run lint` is known-broken pre-existing — ignore it.
- **Non-PII only** in anything buyer-facing — never render owner name/email for a not-listed location.
- **Brand colors (verbatim):** for-sale dot `#db2777`, new not-listed dot `#64748b`, competitor opportunity `#B9772E`, competitor closed border `#8F7067`, brand ink `#1F1917`, taupe text `#8F7067`.

---

### Task 1: Add coordinate columns to `owner_locations`

**Files:**
- Modify: `src/db/schema/ownerLocations.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `owner_locations.latitude` (`number | null`), `.longitude` (`number | null`), `.geocodedAt` (`Date | null`) on the `OwnerLocation` inferred type; a `(latitude, longitude)` index.

- [ ] **Step 1: Add `doublePrecision` to the imports**

In `src/db/schema/ownerLocations.ts`, change the import block to include `doublePrecision`:

```ts
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  doublePrecision,
} from "drizzle-orm/pg-core"
```

- [ ] **Step 2: Add the three columns**

Immediately after the `syncedAt` column (before the closing `},` of the column object), add:

```ts
    syncedAt: timestamp("synced_at").defaultNow().notNull(),

    // Geocoded from locationAddress for the /browse map (unlisted HS dots).
    // Nullable until geocoded; preserved across full-refresh syncs.
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    geocodedAt: timestamp("geocoded_at"),
```

- [ ] **Step 3: Add the lat/lng index**

In the table's index array (the `(table) => [ ... ]` block), add a bounding-box-prefilter index alongside the existing ones:

```ts
    index("owner_locations_lat_lng_idx").on(table.latitude, table.longitude),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Push the additive schema change**

Run: `npm run db:push`
Expected: drizzle-kit reports adding columns `latitude`, `longitude`, `geocoded_at` and the new index; no data loss warnings (all additions are nullable). If it prompts, accept the additive changes only.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/ownerLocations.ts
git commit -m "feat(db): add geocode columns to owner_locations"
```

---

### Task 2: Pure filter helpers (`hs-locations-filter.ts`)

**Files:**
- Create: `src/lib/hs-locations-filter.ts`
- Test: `src/__tests__/hs-locations-filter.test.ts`

**Interfaces:**
- Consumes: `isWithinRadius` from `@/lib/geo`; `CompetitorScope` from `@/lib/competitor-filter`.
- Produces:
  - `interface HsLocationOpenDates { actualSuiteGoDate: Date | null; suiteClosedDate: Date | null; actualFlagshipGoDate: Date | null; flagshipClosedDate: Date | null }`
  - `interface UnlistedHsLocation { id: string; name: string; city: string | null; state: string | null; latitude: number; longitude: number; openedSince: number | null }`
  - `isLocationOpen(dates: HsLocationOpenDates, now: Date): boolean`
  - `openedSinceYear(dates: HsLocationOpenDates): number | null`
  - `locationDedupeKey(row: { blvdLocationNumber: string | null; blvdLocationName: string }): string`
  - `isNotListed(resolvedBqLocationName: string | null, activeListedBqNames: Set<string>): boolean`
  - `hsLocationInScope(loc: { latitude: number; longitude: number; state: string | null }, scope: CompetitorScope): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/hs-locations-filter.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  isLocationOpen,
  openedSinceYear,
  locationDedupeKey,
  isNotListed,
  hsLocationInScope,
  type HsLocationOpenDates,
} from "@/lib/hs-locations-filter"

const NOW = new Date("2026-07-06T00:00:00Z")
const d = (s: string) => new Date(s)
const dates = (o: Partial<HsLocationOpenDates>): HsLocationOpenDates => ({
  actualSuiteGoDate: null,
  suiteClosedDate: null,
  actualFlagshipGoDate: null,
  flagshipClosedDate: null,
  ...o,
})

describe("isLocationOpen", () => {
  it("is open when the suite has gone and not closed", () => {
    expect(isLocationOpen(dates({ actualSuiteGoDate: d("2019-01-01") }), NOW)).toBe(true)
  })
  it("is open when the flagship has gone and not closed", () => {
    expect(isLocationOpen(dates({ actualFlagshipGoDate: d("2020-05-01") }), NOW)).toBe(true)
  })
  it("is closed when the only open track has a past closed date", () => {
    expect(
      isLocationOpen(dates({ actualSuiteGoDate: d("2019-01-01"), suiteClosedDate: d("2024-01-01") }), NOW)
    ).toBe(false)
  })
  it("treats a future closed date as still open", () => {
    expect(
      isLocationOpen(dates({ actualSuiteGoDate: d("2019-01-01"), suiteClosedDate: d("2027-01-01") }), NOW)
    ).toBe(true)
  })
  it("is not open when the go date is in the future", () => {
    expect(isLocationOpen(dates({ actualSuiteGoDate: d("2027-01-01") }), NOW)).toBe(false)
  })
  it("is not open with no go dates at all", () => {
    expect(isLocationOpen(dates({}), NOW)).toBe(false)
  })
  it("stays open on the flagship track when the suite track has closed", () => {
    expect(
      isLocationOpen(
        dates({
          actualSuiteGoDate: d("2019-01-01"),
          suiteClosedDate: d("2024-01-01"),
          actualFlagshipGoDate: d("2020-01-01"),
        }),
        NOW
      )
    ).toBe(true)
  })
})

describe("openedSinceYear", () => {
  it("returns the earliest go-date year", () => {
    expect(
      openedSinceYear(dates({ actualSuiteGoDate: d("2021-03-01"), actualFlagshipGoDate: d("2019-08-01") }))
    ).toBe(2019)
  })
  it("returns null when neither go date is set", () => {
    expect(openedSinceYear(dates({}))).toBeNull()
  })
})

describe("locationDedupeKey", () => {
  it("prefers the blvd location number", () => {
    expect(locationDedupeKey({ blvdLocationNumber: "  H123 ", blvdLocationName: "Austin" })).toBe("num:H123")
  })
  it("falls back to the normalized name when no number", () => {
    expect(locationDedupeKey({ blvdLocationNumber: null, blvdLocationName: "  Austin Domain " })).toBe(
      "name:austin domain"
    )
  })
})

describe("isNotListed", () => {
  const listed = new Set(["Austin Domain", "Dallas Uptown"])
  it("is not listed when the resolved name is absent from the active set", () => {
    expect(isNotListed("Houston Heights", listed)).toBe(true)
  })
  it("is listed (excluded) when the resolved name is in the active set", () => {
    expect(isNotListed("Austin Domain", listed)).toBe(false)
  })
  it("treats an unresolved (null) name as not listed", () => {
    expect(isNotListed(null, listed)).toBe(true)
  })
})

describe("hsLocationInScope", () => {
  const loc = { latitude: 30.4, longitude: -97.72, state: "TX" }
  it("passes with no scope constraints", () => {
    expect(hsLocationInScope(loc, {})).toBe(true)
  })
  it("filters by state set", () => {
    expect(hsLocationInScope(loc, { states: ["CA"] })).toBe(false)
    expect(hsLocationInScope(loc, { states: ["TX"] })).toBe(true)
  })
  it("excludes a null-state location when a state filter is active", () => {
    expect(hsLocationInScope({ ...loc, state: null }, { states: ["TX"] })).toBe(false)
  })
  it("filters by radius", () => {
    expect(
      hsLocationInScope(loc, { centerLat: 30.4, centerLng: -97.72, radiusMiles: 5 })
    ).toBe(true)
    expect(
      hsLocationInScope(loc, { centerLat: 40.0, centerLng: -97.72, radiusMiles: 5 })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hs-locations-filter`
Expected: FAIL — cannot resolve `@/lib/hs-locations-filter`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/hs-locations-filter.ts`:

```ts
import { isWithinRadius } from "./geo"
import type { CompetitorScope } from "./competitor-filter"

/** owner_locations date fields needed to decide whether a location is open. */
export interface HsLocationOpenDates {
  actualSuiteGoDate: Date | null
  suiteClosedDate: Date | null
  actualFlagshipGoDate: Date | null
  flagshipClosedDate: Date | null
}

/** A map dot for an open Hello Sugar location that is NOT listed for sale. */
export interface UnlistedHsLocation {
  id: string
  name: string
  city: string | null
  state: string | null
  latitude: number
  longitude: number
  openedSince: number | null
}

/** A track (suite or flagship) is live if it has gone and hasn't since closed. */
function trackOpen(goDate: Date | null, closedDate: Date | null, now: Date): boolean {
  if (!goDate || goDate.getTime() > now.getTime()) return false
  if (closedDate && closedDate.getTime() <= now.getTime()) return false
  return true
}

/** Open on EITHER the suite or the flagship track. */
export function isLocationOpen(dates: HsLocationOpenDates, now: Date): boolean {
  return (
    trackOpen(dates.actualSuiteGoDate, dates.suiteClosedDate, now) ||
    trackOpen(dates.actualFlagshipGoDate, dates.flagshipClosedDate, now)
  )
}

/** Year of the earliest actual go-date (suite or flagship); null if neither set. */
export function openedSinceYear(dates: HsLocationOpenDates): number | null {
  const times = [dates.actualSuiteGoDate, dates.actualFlagshipGoDate]
    .filter((x): x is Date => x != null)
    .map((x) => x.getTime())
  if (times.length === 0) return null
  return new Date(Math.min(...times)).getUTCFullYear()
}

/** One dot per physical location: prefer the blvd number, else the normalized name. */
export function locationDedupeKey(row: {
  blvdLocationNumber: string | null
  blvdLocationName: string
}): string {
  const num = row.blvdLocationNumber?.trim()
  if (num) return `num:${num}`
  return `name:${row.blvdLocationName.trim().toLowerCase()}`
}

/**
 * Not listed = the resolved BigQuery name is not among the active listings' bq
 * names. An unresolved (null) name cannot match, so it counts as not listed.
 */
export function isNotListed(
  resolvedBqLocationName: string | null,
  activeListedBqNames: Set<string>
): boolean {
  if (!resolvedBqLocationName) return true
  return !activeListedBqNames.has(resolvedBqLocationName)
}

/** Scope test mirroring competitorInScope; a null state fails an active state filter. */
export function hsLocationInScope(
  loc: { latitude: number; longitude: number; state: string | null },
  scope: CompetitorScope
): boolean {
  if (scope.states && scope.states.length > 0) {
    if (!loc.state || !scope.states.includes(loc.state)) return false
  }
  if (scope.centerLat != null && scope.centerLng != null && scope.radiusMiles != null) {
    if (
      !isWithinRadius(scope.centerLat, scope.centerLng, loc.latitude, loc.longitude, scope.radiusMiles)
    ) {
      return false
    }
  }
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- hs-locations-filter`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hs-locations-filter.ts src/__tests__/hs-locations-filter.test.ts
git commit -m "feat: pure predicates for unlisted HS location filtering"
```

---

### Task 3: Hover popup builder (`hs-location-popup.ts`)

**Files:**
- Create: `src/components/browse/hs-location-popup.ts`
- Test: `src/__tests__/hs-location-popup.test.ts`

**Interfaces:**
- Consumes: `UnlistedHsLocation` from `@/lib/hs-locations-filter`.
- Produces: `hsLocationPopupHtml(loc: UnlistedHsLocation): string` — a self-contained, HTML-escaped popup fragment containing name, city/state, and "Open since {year}", with NO owner PII.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/hs-location-popup.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { hsLocationPopupHtml } from "@/components/browse/hs-location-popup"
import type { UnlistedHsLocation } from "@/lib/hs-locations-filter"

const base: UnlistedHsLocation = {
  id: "loc-1",
  name: "Austin Domain",
  city: "Austin",
  state: "TX",
  latitude: 30.4,
  longitude: -97.72,
  openedSince: 2019,
}

describe("hsLocationPopupHtml", () => {
  it("includes the name, place, and open-since year", () => {
    const html = hsLocationPopupHtml(base)
    expect(html).toContain("Austin Domain")
    expect(html).toContain("Austin, TX")
    expect(html).toContain("Open since 2019")
  })

  it("marks the location as not for sale", () => {
    expect(hsLocationPopupHtml(base).toLowerCase()).toContain("not for sale")
  })

  it("omits the open-since line when the year is unknown", () => {
    expect(hsLocationPopupHtml({ ...base, openedSince: null })).not.toContain("Open since")
  })

  it("escapes HTML in the name to prevent injection", () => {
    const html = hsLocationPopupHtml({ ...base, name: "<img src=x onerror=alert(1)>" })
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img src=x")
  })

  it("never leaks owner PII fields (no @, no 'owner')", () => {
    const html = hsLocationPopupHtml(base).toLowerCase()
    expect(html).not.toContain("@")
    expect(html).not.toContain("owner")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hs-location-popup`
Expected: FAIL — cannot resolve `@/components/browse/hs-location-popup`.

- [ ] **Step 3: Write the implementation**

Create `src/components/browse/hs-location-popup.ts`:

```ts
import type { UnlistedHsLocation } from "@/lib/hs-locations-filter"

// Escape untrusted text before injecting into popup HTML. (Mirrors the local
// helper in MapView.tsx; kept here so the builder is independently testable.)
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Brand-styled hover card for an open Hello Sugar location that is not for sale.
 * NON-PII ONLY: name, city/state (or nothing), and "Open since {year}".
 */
export function hsLocationPopupHtml(loc: UnlistedHsLocation): string {
  const place = [loc.city, loc.state]
    .filter((s): s is string => !!s)
    .map(escapeHtml)
    .join(", ")

  const badge = `<div style="display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:#eef2f7;color:#64748b;padding:2px 8px;border-radius:999px;margin-bottom:6px;">Hello Sugar · not for sale</div>`

  const placeLine = place
    ? `<div style="font-size:12px;color:#8F7067;margin-top:6px;">${place}</div>`
    : ""

  const sinceLine =
    loc.openedSince != null
      ? `<div style="font-size:12px;color:#8F7067;margin-top:6px;">Open since ${loc.openedSince}</div>`
      : ""

  return `
    <div style="font-family:'Montserrat',system-ui,sans-serif;padding:4px 4px 2px;max-width:220px;">
      ${badge}
      <div style="font-size:15px;font-weight:700;color:#1F1917;line-height:1.25;">${escapeHtml(loc.name)}</div>
      ${placeLine}
      ${sinceLine}
    </div>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- hs-location-popup`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/hs-location-popup.ts src/__tests__/hs-location-popup.test.ts
git commit -m "feat: non-PII hover popup for unlisted HS locations"
```

---

### Task 4: Read query (`hs-locations-query.ts`)

**Files:**
- Create: `src/lib/hs-locations-query.ts`

**Interfaces:**
- Consumes: `db` from `@/db`; `ownerLocations` from `@/db/schema`; `listings`, `listingLocations` from `@/db/schema/listings`; `boundingBox` from `@/lib/geo`; `parseUsAddressTail` from `@/lib/geocode/address`; `CompetitorScope` from `@/lib/competitor-filter`; all predicates + `UnlistedHsLocation` from `@/lib/hs-locations-filter`.
- Produces: `getUnlistedHsLocations(scope?: CompetitorScope): Promise<UnlistedHsLocation[]>` — resilient (returns `[]` on failure).

> No unit test: this is DB glue with no test-DB in the repo (mirrors `competitor-query.ts`, which is also untested). Its logic is covered by Task 2's predicate tests; the query itself is gated by `tsc` and exercised at runtime in Task 10.

- [ ] **Step 1: Write the query module**

Create `src/lib/hs-locations-query.ts`:

```ts
import { db } from "@/db"
import { ownerLocations } from "@/db/schema"
import { listings, listingLocations } from "@/db/schema/listings"
import { and, eq, gte, lte, isNotNull } from "drizzle-orm"
import { boundingBox } from "./geo"
import { parseUsAddressTail } from "./geocode/address"
import type { CompetitorScope } from "./competitor-filter"
import {
  isLocationOpen,
  isNotListed,
  hsLocationInScope,
  locationDedupeKey,
  openedSinceYear,
  type UnlistedHsLocation,
} from "./hs-locations-filter"

/**
 * READ-ONLY: open Hello Sugar locations that are NOT currently listed for sale,
 * for the /browse map dots. Only geocoded rows are returned. Resilient by
 * design — returns [] if anything fails, so it never blocks the page.
 */
export async function getUnlistedHsLocations(
  scope?: CompetitorScope
): Promise<UnlistedHsLocation[]> {
  try {
    // Only geocoded rows; bounding-box prefilter (uses the index) when a full
    // center+radius scope is set.
    const conds = [isNotNull(ownerLocations.latitude), isNotNull(ownerLocations.longitude)]
    if (
      scope?.centerLat != null &&
      scope.centerLng != null &&
      scope.radiusMiles != null
    ) {
      const box = boundingBox(scope.centerLat, scope.centerLng, scope.radiusMiles)
      conds.push(
        gte(ownerLocations.latitude, box.latMin),
        lte(ownerLocations.latitude, box.latMax),
        gte(ownerLocations.longitude, box.lngMin),
        lte(ownerLocations.longitude, box.lngMax)
      )
    }

    const rows = await db.select().from(ownerLocations).where(and(...conds))

    // BigQuery names of locations that are actively listed for sale — excluded.
    const listed = await db
      .select({ bqLocationName: listingLocations.bqLocationName })
      .from(listingLocations)
      .innerJoin(listings, eq(listingLocations.listingId, listings.id))
      .where(and(eq(listings.status, "active"), isNotNull(listingLocations.bqLocationName)))
    const activeListedBqNames = new Set(
      listed.map((l) => l.bqLocationName).filter((n): n is string => n != null)
    )

    const now = new Date()
    const seen = new Set<string>()
    const out: UnlistedHsLocation[] = []

    for (const r of rows) {
      if (r.latitude == null || r.longitude == null) continue
      if (!isLocationOpen(r, now)) continue
      if (!isNotListed(r.resolvedBqLocationName, activeListedBqNames)) continue

      const key = locationDedupeKey(r)
      if (seen.has(key)) continue

      const tail = r.locationAddress ? parseUsAddressTail(r.locationAddress) : null
      const loc: UnlistedHsLocation = {
        id: r.id,
        name: r.blvdLocationName,
        city: tail?.city ?? null,
        state: tail?.state ?? null,
        latitude: r.latitude,
        longitude: r.longitude,
        openedSince: openedSinceYear(r),
      }
      if (scope && !hsLocationInScope(loc, scope)) continue

      seen.add(key)
      out.push(loc)
    }

    return out
  } catch (err) {
    console.error("getUnlistedHsLocations failed; rendering map without HS location pins", err)
    return []
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hs-locations-query.ts
git commit -m "feat: query open, unlisted, geocoded HS locations"
```

---

### Task 5: One-time geocode backfill script

**Files:**
- Create: `scripts/geocode-owner-locations.ts`

**Interfaces:**
- Consumes: `owner_locations` rows lacking coords; `cleanAddress` from `../src/lib/geocode/address`; MapTiler geocoding HTTP API.
- Produces: writes `latitude`, `longitude`, `geocodedAt` on geocoded rows. Idempotent, throttled, best-effort.

> No unit test: standalone scripts aren't tested in this repo (see `scripts/geocode-locations.ts`). Verified by a `--dry-run`.

- [ ] **Step 1: Write the script**

Create `scripts/geocode-owner-locations.ts` (mirrors `scripts/geocode-locations.ts`):

```ts
/**
 * Backfill geocoded coordinates for owner_locations rows that don't have them.
 *
 * Run:  npx tsx scripts/geocode-owner-locations.ts            (live)
 *       npx tsx scripts/geocode-owner-locations.ts --dry-run  (no DB writes)
 *
 * Requires MAPTILER_API_KEY in .env.local — a SEPARATE, UNRESTRICTED server key
 * (server requests send no Origin header, so a domain-locked key is rejected).
 *
 * Safe to re-run: skips rows that already have coordinates, throttles between
 * calls, only accepts results above a relevance threshold, and never aborts the
 * whole run because of a single failure.
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/neon-http"
import { neon } from "@neondatabase/serverless"
import { isNull, eq } from "drizzle-orm"
import { ownerLocations } from "../src/db/schema/ownerLocations"
import { cleanAddress } from "../src/lib/geocode/address"

const RELEVANCE_THRESHOLD = 0.8
const THROTTLE_MS = 300
const DRY_RUN = process.argv.includes("--dry-run")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface GeocodeResult {
  lat: number
  lng: number
  relevance: number
  placeName: string
}

async function geocode(query: string, apiKey: string): Promise<GeocodeResult | null> {
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
    query
  )}.json?key=${apiKey}&country=us&limit=1`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`MapTiler ${res.status} ${res.statusText}`)
  const data = (await res.json()) as {
    features?: { center?: [number, number]; relevance?: number; place_name?: string }[]
  }
  const top = data.features?.[0]
  if (!top?.center) return null
  const [lng, lat] = top.center
  return { lat, lng, relevance: top.relevance ?? 0, placeName: top.place_name ?? "" }
}

async function main() {
  const apiKey = process.env.MAPTILER_API_KEY
  if (!apiKey) {
    console.error(
      "MAPTILER_API_KEY is not set. Add an UNRESTRICTED server key to .env.local (see .env.example)."
    )
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.")
    process.exit(1)
  }

  const db = drizzle(neon(process.env.DATABASE_URL))

  const rows = await db
    .select({
      id: ownerLocations.id,
      name: ownerLocations.blvdLocationName,
      address: ownerLocations.locationAddress,
    })
    .from(ownerLocations)
    .where(isNull(ownerLocations.latitude))

  console.log(
    `Found ${rows.length} owner location(s) without coordinates.${DRY_RUN ? " (dry run)" : ""}\n`
  )

  let updated = 0
  const lowConfidence: { name: string; query: string; relevance: number }[] = []
  const skipped: { name: string; reason: string }[] = []
  const failed: { name: string; error: string }[] = []

  for (const row of rows) {
    if (!row.address) {
      skipped.push({ name: row.name, reason: "no address" })
      continue
    }
    const query = cleanAddress(row.address)
    if (!query) {
      skipped.push({ name: row.name, reason: "empty after cleaning" })
      continue
    }

    try {
      const result = await geocode(query, apiKey)
      if (!result) {
        failed.push({ name: row.name, error: "no geocoding result" })
      } else if (result.relevance < RELEVANCE_THRESHOLD) {
        lowConfidence.push({ name: row.name, query, relevance: result.relevance })
      } else {
        console.log(
          `✓ ${row.name} -> ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)} ` +
            `(relevance ${result.relevance.toFixed(2)}) [${result.placeName}]`
        )
        if (!DRY_RUN) {
          await db
            .update(ownerLocations)
            .set({ latitude: result.lat, longitude: result.lng, geocodedAt: new Date() })
            .where(eq(ownerLocations.id, row.id))
        }
        updated++
      }
    } catch (err) {
      failed.push({ name: row.name, error: err instanceof Error ? err.message : String(err) })
    }

    await sleep(THROTTLE_MS)
  }

  console.log(`\n${"=".repeat(50)}`)
  console.log(`${DRY_RUN ? "[dry run] would update" : "Updated"}: ${updated}`)
  if (lowConfidence.length) {
    console.log(`\nLow confidence (NOT written):`)
    for (const r of lowConfidence) console.log(`  - ${r.name} — relevance ${r.relevance.toFixed(2)} — "${r.query}"`)
  }
  if (skipped.length) {
    console.log(`\nSkipped:`)
    for (const r of skipped) console.log(`  - ${r.name} — ${r.reason}`)
  }
  if (failed.length) {
    console.log(`\nFailed:`)
    for (const r of failed) console.log(`  - ${r.name} — ${r.error}`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error("Backfill failed:", e)
  process.exit(1)
})
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Dry-run to verify it connects and lists rows**

Run: `npx tsx scripts/geocode-owner-locations.ts --dry-run`
Expected: prints "Found N owner location(s) without coordinates. (dry run)" and a per-row `✓ … -> lat, lng` trace with no DB writes. (Requires `MAPTILER_API_KEY` + `DATABASE_URL` in `.env.local`.)

- [ ] **Step 4: Commit**

```bash
git add scripts/geocode-owner-locations.ts
git commit -m "feat: backfill script to geocode owner_locations"
```

---

### Task 6: Preserve + geocode coords during directory sync

**Files:**
- Modify: `src/lib/owner-directory/sync.ts`

**Interfaces:**
- Consumes: `geocodeAddress` from `@/lib/geocode/geocode`; adds `isNull`, `eq` to the existing `drizzle-orm` import.
- Produces: `SyncResult` gains `geocoded: number`; coords are preserved across refreshes and newly-missing rows are geocoded best-effort.

> The cron route test (`src/__tests__/cron-sync-owner-directory.test.ts`) mocks `syncOwnerLocations` wholesale, so extending `SyncResult` and the function body does not break it. Gate with `tsc` + the full suite.

- [ ] **Step 1: Extend the imports**

In `src/lib/owner-directory/sync.ts`, update the drizzle import and add the geocoder import:

```ts
import { inArray, sql, isNull, eq } from "drizzle-orm"
```

Add after the existing `import { normalizeEmail } from "./email"` line:

```ts
import { geocodeAddress } from "@/lib/geocode/geocode"
```

- [ ] **Step 2: Add `geocoded` to the result type**

In the `SyncResult` type, add a field:

```ts
export type SyncResult = {
  fetched: number
  duplicatesDropped: number
  upserted: number
  deletedStale: number
  preserved: number
  geocoded: number
  byMethod: Record<BlvdMatchMethod, number>
  bqNamesAvailable: boolean
}
```

- [ ] **Step 3: Select existing coords so they can be preserved**

In the `existing` select, add the three coordinate columns:

```ts
  const existing = await db
    .select({
      id: ownerLocations.id,
      ownerIdentifier: ownerLocations.ownerIdentifier,
      blvdLocationName: ownerLocations.blvdLocationName,
      resolvedBqLocationName: ownerLocations.resolvedBqLocationName,
      blvdMatchMethod: ownerLocations.blvdMatchMethod,
      blvdMatchConfidence: ownerLocations.blvdMatchConfidence,
      latitude: ownerLocations.latitude,
      longitude: ownerLocations.longitude,
      geocodedAt: ownerLocations.geocodedAt,
    })
    .from(ownerLocations)
```

- [ ] **Step 4: Carry prior coords into the upsert values**

In the `values = deduped.map((r) => { ... })` return object, add three fields after `syncedAt: now,`:

```ts
      syncedAt: now,
      // Preserve geocoded coords across the full-refresh (like resolvedBqLocationName).
      latitude: prior?.latitude ?? null,
      longitude: prior?.longitude ?? null,
      geocodedAt: prior?.geocodedAt ?? null,
```

- [ ] **Step 5: Keep coords on conflict**

In the `onConflictDoUpdate({ ..., set: { ... } })` block, add three entries after `syncedAt: sql\`excluded.synced_at\`,`:

```ts
              syncedAt: sql`excluded.synced_at`,
              latitude: sql`excluded.latitude`,
              longitude: sql`excluded.longitude`,
              geocodedAt: sql`excluded.geocoded_at`,
```

- [ ] **Step 6: Geocode newly-missing rows after the batch**

Replace the final `return { ... }` block with a geocode pass followed by the return:

```ts
  // Best-effort geocode of rows still missing coords (new locations, or rows
  // whose address changed). Never blocks the sync; silent when no MapTiler key.
  let geocoded = 0
  if (process.env.MAPTILER_API_KEY) {
    const missing = await db
      .select({ id: ownerLocations.id, locationAddress: ownerLocations.locationAddress })
      .from(ownerLocations)
      .where(isNull(ownerLocations.latitude))
    for (const m of missing) {
      if (!m.locationAddress) continue
      const geo = await geocodeAddress(m.locationAddress)
      if (!geo) continue
      await db
        .update(ownerLocations)
        .set({ latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date() })
        .where(eq(ownerLocations.id, m.id))
      geocoded++
    }
  }

  return {
    fetched: rows.length,
    duplicatesDropped,
    upserted: values.length,
    deletedStale: staleIds.length,
    preserved,
    geocoded,
    byMethod,
    bqNamesAvailable: bqNames !== null,
  }
```

- [ ] **Step 7: Typecheck and run the suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all tests pass, including `cron-sync-owner-directory` (still green — the sync is mocked there).

- [ ] **Step 8: Commit**

```bash
git add src/lib/owner-directory/sync.ts
git commit -m "feat(sync): preserve and backfill owner_locations coordinates"
```

---

### Task 7: Slate dot layer in `MapView`

**Files:**
- Modify: `src/components/browse/MapView.tsx`

**Interfaces:**
- Consumes: `hsLocationPopupHtml` from `./hs-location-popup`; `UnlistedHsLocation` from `@/lib/hs-locations-filter`.
- Produces: `MapView` accepts `hsLocations?: UnlistedHsLocation[]` and `showHsLocations?: boolean` (default true) and renders slate `#64748b` dots with hover popups and NO click handler.

> No unit test (MapTiler needs WebGL; repo has no DOM test env). Gate with `tsc`; behavior verified in Task 10.

- [ ] **Step 1: Add the imports**

At the top of `src/components/browse/MapView.tsx`, after the existing `CompetitorClosure` type import, add:

```ts
import type { UnlistedHsLocation } from "@/lib/hs-locations-filter"
import { hsLocationPopupHtml } from "./hs-location-popup"
```

- [ ] **Step 2: Extend the props interface**

In `interface MapViewProps`, add after `showListings?: boolean`:

```ts
  showListings?: boolean
  // Open HS locations that are NOT for sale — map-only, hover-only, no navigation.
  hsLocations?: UnlistedHsLocation[]
  showHsLocations?: boolean
```

- [ ] **Step 3: Destructure the new props with defaults**

In the `MapView({ ... })` parameter destructure, add alongside the other defaults (e.g. after `showListings = true,`):

```ts
  showListings = true,
  hsLocations = [],
  showHsLocations = true,
```

- [ ] **Step 4: Add a marker ref**

Next to `const competitorMarkers = useRef(...)`, add:

```ts
  const hsMarkers = useRef<{ marker: maptilersdk.Marker; id: string }[]>([])
```

- [ ] **Step 5: Add the slate-dot marker effect**

After the competitor-closure layer `useEffect` (the one ending with `}, [competitors, showCompetitors, savedPlaceIds.join(","), onHover])`), add a new effect:

```ts
  // Unlisted Hello Sugar locations: a third marker layer of solid slate dots.
  // Hover shows a non-PII popup; there is deliberately NO click handler (these
  // never navigate) and no onHover coordination (they aren't in the list).
  useEffect(() => {
    const m = map.current
    if (!m) return

    const apply = () => {
      hsMarkers.current.forEach(({ marker }) => marker.remove())
      hsMarkers.current = []
      if (!showHsLocations) return

      const valid = hsLocations.filter(
        (l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)
      )

      for (const loc of valid) {
        const el = document.createElement("div")
        el.dataset.hsLocationId = loc.id

        const inner = document.createElement("div")
        inner.style.cssText = `
          width: 16px;
          height: 16px;
          background-color: #64748b;
          border: 2px solid white;
          border-radius: 50%;
          cursor: default;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          transition: transform 0.15s ease;
        `
        el.appendChild(inner)

        const popup = new maptilersdk.Popup({
          offset: 20,
          closeButton: false,
          maxWidth: "220px",
        }).setHTML(hsLocationPopupHtml(loc))

        const marker = new maptilersdk.Marker({ element: el })
          .setLngLat([loc.longitude, loc.latitude])
          .setPopup(popup)
          .addTo(m)

        el.addEventListener("mouseenter", () => {
          inner.style.transform = "scale(1.25)"
          popup.addTo(m)
        })
        el.addEventListener("mouseleave", () => {
          inner.style.transform = "scale(1)"
          popup.remove()
        })

        hsMarkers.current.push({ marker, id: loc.id })
      }
    }

    if (mapReady.current) apply()
    else m.once("load", apply)
  }, [hsLocations, showHsLocations])
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/browse/MapView.tsx
git commit -m "feat(map): slate dot layer for unlisted HS locations"
```

---

### Task 8: Filter state + collapsible `MapLegend`

**Files:**
- Modify: `src/components/browse/FilterBar.tsx`
- Create: `src/components/browse/MapLegend.tsx`

**Interfaces:**
- Consumes: `useListingFilters` from `./FilterBar`.
- Produces: `useListingFilters` gains `showHsLocations` (boolean, default true); `MapLegend` React component (no props) that renders 4 swatches / 3 toggles bound to `showListings`, `showHsLocations`, `showCompetitors`.

> No unit test (React component, node-only test env). Gate with `tsc`; verified visually in Task 10.

- [ ] **Step 1: Add `showHsLocations` to the URL filter state**

In `src/components/browse/FilterBar.tsx`, inside `useQueryStates({ ... })`, add after `showCompetitors: parseAsBoolean.withDefault(true),`:

```ts
    showCompetitors: parseAsBoolean.withDefault(true),
    showHsLocations: parseAsBoolean.withDefault(true),
```

- [ ] **Step 2: Create the `MapLegend` component**

Create `src/components/browse/MapLegend.tsx`:

```tsx
"use client"

import { useState } from "react"
import { useListingFilters } from "./FilterBar"

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3 w-3 rounded-full border border-white"
      style={{ backgroundColor: color, boxShadow: "0 0 0 1px rgba(0,0,0,.08)" }}
    />
  )
}

function Diamond({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] border border-white"
      style={{ backgroundColor: color, boxShadow: "0 0 0 1px rgba(0,0,0,.08)" }}
    />
  )
}

function DiamondHollow() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2.5 w-2.5 rotate-45 rounded-[2px] bg-white"
      style={{ border: "1.5px solid #8F7067" }}
    />
  )
}

function ToggleRow({
  label,
  active,
  onClick,
  swatch,
}: {
  label: string
  active: boolean
  onClick: () => void
  swatch?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center gap-2 py-1 text-left text-xs font-medium transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-1
        ${active ? "text-gray-800" : "text-gray-300"}`}
    >
      {swatch ? <span className="flex w-4 justify-center">{swatch}</span> : <span className="w-4" />}
      <span className={active ? "" : "line-through"}>{label}</span>
    </button>
  )
}

/** Collapsible on-map key: 4 swatches, 3 toggles. */
export function MapLegend() {
  const [filters, setFilters] = useListingFilters()
  const [collapsed, setCollapsed] = useState(false)
  const compActive = filters.showCompetitors

  return (
    <div className="absolute bottom-3 left-3 z-10 w-52 rounded-xl border border-gray-200 bg-white/95 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500"
      >
        Map key
        <svg
          className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3">
          <ToggleRow
            label="For sale"
            active={filters.showListings}
            onClick={() => setFilters({ showListings: !filters.showListings })}
            swatch={<Dot color="#db2777" />}
          />
          <ToggleRow
            label="Hello Sugar (not listed)"
            active={filters.showHsLocations}
            onClick={() => setFilters({ showHsLocations: !filters.showHsLocations })}
            swatch={<Dot color="#64748b" />}
          />

          <div className="mt-1.5 border-t border-gray-100 pt-1.5">
            <ToggleRow
              label="Competitors"
              active={compActive}
              onClick={() => setFilters({ showCompetitors: !filters.showCompetitors })}
            />
            <div className={`flex items-center gap-2 py-0.5 pl-6 text-xs ${compActive ? "text-gray-500" : "text-gray-300"}`}>
              <Diamond color="#B9772E" />
              <span>Opportunity</span>
            </div>
            <div className={`flex items-center gap-2 py-0.5 pl-6 text-xs ${compActive ? "text-gray-500" : "text-gray-300"}`}>
              <DiamondHollow />
              <span>Closed</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/browse/FilterBar.tsx src/components/browse/MapLegend.tsx
git commit -m "feat(map): collapsible map key with showHsLocations toggle"
```

---

### Task 9: Wire the layer through `BrowsePage` and the route

**Files:**
- Modify: `src/app/browse/page.tsx`
- Modify: `src/components/browse/BrowsePage.tsx`
- Modify: `src/components/browse/FilterBar.tsx` (retire `LayerToggles`/`LayerChip`)

**Interfaces:**
- Consumes: `getUnlistedHsLocations` from `@/lib/hs-locations-query`; `UnlistedHsLocation` from `@/lib/hs-locations-filter`; `MapLegend` from `./MapLegend`.
- Produces: unlisted HS locations fetched server-side and passed to `MapView` only (never to `BrowseListContent`); `MapLegend` rendered over the map; top-bar `LayerToggles` removed.

> No unit test (server component + wiring). Gate with `tsc` + full suite; verified in Task 10.

- [ ] **Step 1: Fetch the layer in the route**

In `src/app/browse/page.tsx`, add the import after the `getCompetitorClosures` import:

```ts
import { getUnlistedHsLocations } from "@/lib/hs-locations-query"
```

Replace the `Promise.all` destructuring block with one that also fetches HS locations:

```ts
  const filters = parseFilters(searchParams)
  const [{ items: initialListings }, competitorClosures, savedCompetitorIds, hsLocations] =
    await Promise.all([
      getListings(filters),
      getCompetitorClosures({
        centerLat: filters.centerLat,
        centerLng: filters.centerLng,
        radiusMiles: filters.radiusMiles,
        states: filters.states,
      }),
      getSavedCompetitorPlaceIds(),
      getUnlistedHsLocations({
        centerLat: filters.centerLat,
        centerLng: filters.centerLng,
        radiusMiles: filters.radiusMiles,
        states: filters.states,
      }),
    ])
  const count = initialListings.length
```

Pass it to `BrowsePage`:

```tsx
      <BrowsePage
        initialListings={initialListings}
        competitorClosures={competitorClosures}
        savedCompetitorIds={savedCompetitorIds}
        hsLocations={hsLocations}
      />
```

- [ ] **Step 2: Accept + forward the prop in `BrowsePage`**

In `src/components/browse/BrowsePage.tsx`, add the imports:

```ts
import type { UnlistedHsLocation } from "@/lib/hs-locations-filter"
import { MapLegend } from "./MapLegend"
```

Add to `interface BrowsePageProps`:

```ts
  savedCompetitorIds?: string[]
  hsLocations?: UnlistedHsLocation[]
```

Add to the destructured params with a default:

```ts
  savedCompetitorIds = [],
  hsLocations = [],
```

Read the new flag next to the existing `showListings`/`showCompetitors`:

```ts
  const showListings = rawFilters.showListings
  const showCompetitors = rawFilters.showCompetitors
  const showHsLocations = rawFilters.showHsLocations
```

- [ ] **Step 3: Remove the top-bar `LayerToggles`**

Still in `BrowsePage.tsx`, update the `FilterBar` import to drop `LayerToggles`:

```ts
import { FilterBar, useListingFilters, RADIUS_MIN_MILES, RADIUS_MAX_MILES, DEFAULT_RADIUS_MILES } from "./FilterBar"
```

Delete the desktop layer-toggle block entirely:

```tsx
          {/* Map-layer visibility (moved off the top bar) */}
          <div className="hidden md:flex">
            <LayerToggles />
          </div>
```

- [ ] **Step 4: Pass the layer to `MapView` + render `MapLegend`**

In the map panel, extend the `MapView` props and add the legend overlay. Replace the map-panel block:

```tsx
            {/* Map panel */}
            <div className="w-full md:w-2/3 relative">
              <MapView
                listings={initialListings}
                competitors={competitorClosures}
                showCompetitors={showCompetitors}
                showListings={showListings}
                hsLocations={hsLocations}
                showHsLocations={showHsLocations}
                savedPlaceIds={savedCompetitorIdList}
                onToggleSaveCompetitor={handleToggleSaveCompetitor}
                hoveredId={hoveredId}
                onHover={setHoveredId}
                onListingClick={handleListingClick}
                selectedCompetitor={selectedCompetitor}
                center={searchCenter}
                radiusMiles={searchCenter ? rawFilters.radiusMiles ?? DEFAULT_RADIUS_MILES : null}
              />

              <MapLegend />

              {shouldShowRadiusHint(viewMode, searchCenter !== null, hintDismissed) && (
                <RadiusSearchHint onDismiss={() => setHintDismissed(true)} />
              )}
            </div>
```

(Note: `hsLocations` is intentionally NOT passed to either `BrowseListContent` — these dots are map-only.)

- [ ] **Step 5: Delete the now-unused `LayerToggles`/`LayerChip`**

In `src/components/browse/FilterBar.tsx`, delete the `LayerToggles` and `LayerChip` functions (the block starting `// ---- Map-layer toggles ...` through the end of `LayerChip`). Their swatch styling now lives in `MapLegend`.

- [ ] **Step 6: Typecheck and run the suite**

Run: `npx tsc --noEmit`
Expected: no errors (no lingering references to `LayerToggles`).

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/browse/page.tsx src/components/browse/BrowsePage.tsx src/components/browse/FilterBar.tsx
git commit -m "feat(browse): wire unlisted HS location layer + on-map key"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

Run: `npm test`
Expected: all suites pass.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Populate coordinates (one-time)**

Run: `npx tsx scripts/geocode-owner-locations.ts`
Expected: rows geocoded and written; note the succeeded/low-confidence/failed counts. (Re-runnable; skips rows that already have coords.)

- [ ] **Step 3: Manual browse check**

Ask the user to start the dev server (do NOT auto-start it) and open `/browse` in map view, then confirm:
- Slate `#64748b` dots appear for open, not-for-sale HS locations.
- A listed (for-sale) location shows only the pink dot, not a slate one.
- Hovering a slate dot shows the non-PII card (name, city/state, "Open since …") and no owner name/email; there is no click-through.
- The slate dots do NOT appear in the left card list.
- The bottom-left "Map key" collapses/expands; the "For sale", "Hello Sugar (not listed)", and "Competitors" toggles each show/hide their markers; the two competitor sub-swatches (Opportunity/Closed) dim together with the one Competitors toggle.

- [ ] **Step 4: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to open the PR against `origin/main`.

---

## Self-Review

**Spec coverage:**
- Open, not-listed dataset → Task 2 (`isLocationOpen`, `isNotListed`) + Task 4 (query). ✓
- Non-PII hover → Task 3 (popup, PII-absence test). ✓
- Map-only (not in cards) → Task 9 Step 4 note (not passed to `BrowseListContent`). ✓
- No click-through → Task 7 (no click handler). ✓
- Distinct slate dot → Task 7 (`#64748b`). ✓
- Collapsible key, 4 swatches / 3 toggles, retire chips → Tasks 8 + 9. ✓
- Geocoding: columns → Task 1; backfill → Task 5; sync preserve+geocode → Task 6. ✓
- Dedupe / scope / openedSince → Task 2 + Task 4. ✓
- Testing (pure logic) → Tasks 2, 3; DB/components gated by tsc + Task 10. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `UnlistedHsLocation` defined once in Task 2 and imported by Tasks 3, 4, 7, 9. `getUnlistedHsLocations(scope?: CompetitorScope)` signature identical across Tasks 4 and 9. `showHsLocations` flag name identical across Tasks 7, 8, 9. `SyncResult.geocoded` added in Task 6 and unused elsewhere (route spreads it). ✓
