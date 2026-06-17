# Rock 2 — Boulevard Data Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock KPI/financial data on listing details with real Boulevard total sales (and a stubbed MR%), gated behind a human-confirmed listing→Boulevard location mapping.

**Architecture:** A server-only `lib/boulevard` client (isolated GraphQL query + Zod + timeout) is keyed by a `boulevard_location_id` stored on `listing_locations`. A `boulevard_mapping_status` enum (`unconfirmed`/`confirmed`/`not_connected`) gates everything — real dollars are fetched only for `active` listings whose mapping is `confirmed`. Admins confirm mappings at approval time and via a dedicated mappings screen. The KPI fetch layer swaps mock revenue for Boulevard data with a "not connected" fallback; mock survives only behind an explicit dev flag.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Drizzle ORM + Neon Postgres, Zod, Vitest, `unstable_cache`, Tailwind (hs-red tokens).

## Global Constraints

- **Boulevard credentials are server-only** — env vars never prefixed `NEXT_PUBLIC_`; never in the client bundle or the diff.
- **Profit (`ttmProfit`) stays manual** — never auto-populated from Boulevard.
- **Safety invariant:** real Boulevard data is fetched only when `boulevard_mapping_status = 'confirmed'` AND the listing is `active`.
- **Mock data is dev-only** — behind `KPI_USE_MOCK=1` (or absent Boulevard creds in local dev); never the default production path.
- **MR% is stubbed** this round (badged "pending"); New Clients & Bookings cards are kept and badged "Sample — not live".
- `typecheck` (`npx tsc --noEmit`) and `npm test` must be clean after every task. No secrets in commits. `.env.example` gets placeholders only.
- Migrations are journaled (`drizzle-kit generate` → `npm run db:migrate`); additive only.
- Mock the Boulevard client in tests — never hit the live API from tests.

---

## File Structure

**Create:**
- `src/lib/boulevard/types.ts` — Zod schemas + inferred types for Boulevard responses.
- `src/lib/boulevard/match.ts` — pure name-normalization + suggestion matching (unit-testable).
- `src/lib/boulevard/client.ts` — server-only Admin GraphQL client (auth, isolated query, timeout, Zod).
- `src/lib/boulevard/mapping-actions.ts` — server actions to confirm/clear a mapping (admin-only).
- `src/app/admin/boulevard/page.tsx` + `src/components/admin/BoulevardMappings.tsx` — backfill/re-map screen.
- Tests: `src/__tests__/boulevard/match.test.ts`, `client.test.ts`, `src/__tests__/kpi/revenue.test.ts`, `src/__tests__/kpi/access-control.test.ts`, `src/__tests__/boulevard/mapping-actions.test.ts`.

**Modify:**
- `src/db/schema/listings.ts` — two columns on `listing_locations`.
- `src/lib/listing-detail.ts` — surface `boulevardLocationId` + `boulevardMappingStatus` per location.
- `src/lib/kpi/fetch.ts` — real revenue keyed by confirmed mapping; fallback; dev-mock flag.
- `src/lib/kpi/schema.ts` — add `source`/`asOf` fields to `KpiMetric` (already has `updatedAt`).
- `src/components/kpi/KpiSection.tsx`, `KpiCard.tsx` — source badges, "Sample/pending" badges, "as of".
- `src/components/listing-detail/FinancialsGrid.tsx` — real TTM revenue + Boulevard badge + "not connected".
- `src/components/admin/ModerationQueue.tsx` + `AdminListingCard.tsx` — mapping confirm gate at approval.
- `src/lib/listings/actions.ts` (or admin approval action) — block approve until salon mappings resolved.
- `src/app/admin/layout.tsx` — nav link to the mappings screen.
- `.env.example`, `src/lib/env.ts` — Boulevard env vars (optional in dev).

---

## Task 1: Schema — Boulevard mapping columns + journaled migration

**Files:**
- Modify: `src/db/schema/listings.ts` (listing_locations table)
- Create: `drizzle/0001_<name>.sql` + `drizzle/meta/*` (via generate)

**Interfaces:**
- Produces: `listingLocations.boulevardLocationId` (`text | null`), `listingLocations.boulevardMappingStatus` (`'unconfirmed' | 'confirmed' | 'not_connected'`, default `'unconfirmed'`, NOT NULL).

- [ ] **Step 1: Add columns to the schema**

In `src/db/schema/listings.ts`, inside `listingLocations` (after the geocoding columns, before `displayOrder`):

```ts
  // Boulevard join key (Rock 2). Real KPI/financials are fetched ONLY when
  // boulevardMappingStatus === "confirmed". Suggested by name match, human-confirmed.
  boulevardLocationId: text("boulevard_location_id"),
  boulevardMappingStatus: text("boulevard_mapping_status", {
    enum: ["unconfirmed", "confirmed", "not_connected"],
  }).default("unconfirmed").notNull(),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate --name boulevard_mapping`
Expected: a new `drizzle/0001_boulevard_mapping.sql` containing only `ALTER TABLE "listing_locations" ADD COLUMN ...` for the two columns (additive — no drops). Inspect it to confirm.

- [ ] **Step 3: Apply the migration**

Run: `npm run db:migrate`
Expected: `Migrations complete` with no errors.

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/listings.ts drizzle/
git commit -m "feat(rock-2): add boulevard_location_id + mapping_status to listing_locations"
```

---

## Task 2: Boulevard name-match (pure logic)

**Files:**
- Create: `src/lib/boulevard/match.ts`
- Test: `src/__tests__/boulevard/match.test.ts`

**Interfaces:**
- Produces:
  - `normalizeName(name: string): string`
  - `suggestBoulevardMatch(locationName: string, blvd: { id: string; name: string }[]): { id: string; name: string; confidence: number } | null` — best exact/normalized match, `confidence` in `[0,1]`; `null` if no candidate ≥ 0.5.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { normalizeName, suggestBoulevardMatch } from "@/lib/boulevard/match"

const BLVD = [
  { id: "b1", name: "Hello Sugar — Atlanta Buckhead" },
  { id: "b2", name: "Hello Sugar Atlanta Midtown" },
  { id: "b3", name: "Hello Sugar Boise Downtown" },
]

describe("normalizeName", () => {
  it("lowercases, strips punctuation and the brand prefix, collapses whitespace", () => {
    expect(normalizeName("Hello Sugar — Atlanta  Buckhead!")).toBe("atlanta buckhead")
  })
})

describe("suggestBoulevardMatch", () => {
  it("matches the same location across punctuation/casing differences", () => {
    const m = suggestBoulevardMatch("Hello Sugar Atlanta Buckhead", BLVD)
    expect(m?.id).toBe("b1")
    expect(m!.confidence).toBeGreaterThanOrEqual(0.9)
  })
  it("returns null when nothing is close", () => {
    expect(suggestBoulevardMatch("Hello Sugar Dallas Uptown", BLVD)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/boulevard/match.test.ts`
Expected: FAIL — `match.ts` does not exist.

- [ ] **Step 3: Implement `match.ts`**

```ts
const BRAND_PREFIX = /^hello\s+sugar\b/

/** Canonical comparison form: lowercase, drop the brand prefix and punctuation, collapse spaces. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[—–-]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(BRAND_PREFIX, "")
    .trim()
}

/** Token Jaccard similarity in [0,1]. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const sa = new Set(a.split(" ").filter(Boolean))
  const sb = new Set(b.split(" ").filter(Boolean))
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}

export function suggestBoulevardMatch(
  locationName: string,
  blvd: { id: string; name: string }[]
): { id: string; name: string; confidence: number } | null {
  const target = normalizeName(locationName)
  let best: { id: string; name: string; confidence: number } | null = null
  for (const loc of blvd) {
    const confidence = similarity(target, normalizeName(loc.name))
    if (!best || confidence > best.confidence) best = { id: loc.id, name: loc.name, confidence }
  }
  return best && best.confidence >= 0.5 ? best : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/boulevard/match.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boulevard/match.ts src/__tests__/boulevard/match.test.ts
git commit -m "feat(rock-2): boulevard location name-match suggestion"
```

---

## Task 3: Boulevard client (auth + isolated query + Zod + timeout)

**Files:**
- Create: `src/lib/boulevard/types.ts`, `src/lib/boulevard/client.ts`
- Modify: `.env.example`, `src/lib/env.ts`
- Test: `src/__tests__/boulevard/client.test.ts`

**Interfaces:**
- Produces:
  - `MonthlySales = { month: string; sales: number }` (sales in **cents**)
  - `listBoulevardLocations(): Promise<{ id: string; name: string }[] | null>`
  - `fetchMonthlySales(boulevardLocationId: string, months: number): Promise<MonthlySales[] | null>`
  - `fetchMembershipRate(boulevardLocationId: string): Promise<number | null>` — **stub returns null** this round.
- Consumes: env `BOULEVARD_API_URL`, `BOULEVARD_API_KEY` (server-only).

> **Live-iteration point (per spec D1):** the exact GraphQL documents (`LOCATIONS_QUERY`, `SALES_QUERY`) and auth header format are confirmed against the live Admin API during this task. They are isolated as module constants so callers/tests never change. Start from the documents below and adjust field names once a real response is seen.

- [ ] **Step 1: Add env vars (placeholders)**

Append to `.env.example`:

```bash
# Boulevard Admin API (Rock 2 — real KPI/financial data). SERVER-ONLY.
BOULEVARD_API_URL=https://sandbox.joinblvd.com/api/2020-01/admin
BOULEVARD_API_KEY=your-boulevard-admin-api-key
```

In `src/lib/env.ts` add to the `server` block (optional so local dev without creds still boots):

```ts
    BOULEVARD_API_URL: z.string().url().optional(),
    BOULEVARD_API_KEY: z.string().min(1).optional(),
```

- [ ] **Step 2: Write the failing test (mocked fetch)**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

describe("boulevard client", () => {
  const env = process.env
  beforeEach(() => {
    vi.resetModules()
    process.env = { ...env, BOULEVARD_API_URL: "https://blvd.test/admin", BOULEVARD_API_KEY: "k" }
  })
  afterEach(() => { process.env = env; vi.restoreAllMocks() })

  it("returns null when creds are missing", async () => {
    process.env = { ...env }
    delete process.env.BOULEVARD_API_URL
    const { fetchMonthlySales } = await import("@/lib/boulevard/client")
    expect(await fetchMonthlySales("b1", 12)).toBeNull()
  })

  it("returns null when the API errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const { fetchMonthlySales } = await import("@/lib/boulevard/client")
    expect(await fetchMonthlySales("b1", 12)).toBeNull()
  })

  it("parses monthly sales (cents) from a valid response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { location: { monthlySales: [
        { month: "2026-05", salesCents: 4500000 },
      ] } } }),
    })
    const { fetchMonthlySales } = await import("@/lib/boulevard/client")
    const r = await fetchMonthlySales("b1", 12)
    expect(r).toEqual([{ month: "2026-05", sales: 4500000 }])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/boulevard/client.test.ts`
Expected: FAIL — `client.ts` does not exist.

- [ ] **Step 4: Implement `types.ts`**

```ts
import { z } from "zod"

export const monthlySalesResponse = z.object({
  data: z.object({
    location: z.object({
      monthlySales: z.array(z.object({ month: z.string(), salesCents: z.number() })),
    }).nullable(),
  }),
})

export const locationsResponse = z.object({
  data: z.object({
    locations: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
})

export type MonthlySales = { month: string; sales: number }
```

- [ ] **Step 5: Implement `client.ts`**

```ts
import "server-only"
import { monthlySalesResponse, locationsResponse, type MonthlySales } from "./types"

const TIMEOUT_MS = 8000

// --- Live-iteration point: confirm against the real Admin API. -------------
const SALES_QUERY = `
  query LocationMonthlySales($id: ID!, $months: Int!) {
    location(id: $id) { monthlySales(lastMonths: $months) { month salesCents } }
  }`
const LOCATIONS_QUERY = `query Locations { locations { id name } }`
// ---------------------------------------------------------------------------

function creds(): { url: string; key: string } | null {
  const url = process.env.BOULEVARD_API_URL
  const key = process.env.BOULEVARD_API_KEY
  return url && key ? { url, key } : null
}

async function gql(query: string, variables: Record<string, unknown>): Promise<unknown | null> {
  const c = creds()
  if (!c) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: {
        // Admin API: HTTP Basic with the API key. Confirm exact format during iteration.
        Authorization: `Basic ${Buffer.from(`${c.key}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal: ctrl.signal,
    })
    if (!res.ok) {
      console.warn(`[boulevard] API ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    console.warn("[boulevard] request failed:", err)
    return null
  } finally {
    clearTimeout(t)
  }
}

export async function fetchMonthlySales(boulevardLocationId: string, months: number): Promise<MonthlySales[] | null> {
  const raw = await gql(SALES_QUERY, { id: boulevardLocationId, months })
  if (raw === null) return null
  const parsed = monthlySalesResponse.safeParse(raw)
  if (!parsed.success || !parsed.data.data.location) {
    console.warn("[boulevard] sales validation failed")
    return null
  }
  return parsed.data.data.location.monthlySales.map((m) => ({ month: m.month, sales: m.salesCents }))
}

export async function listBoulevardLocations(): Promise<{ id: string; name: string }[] | null> {
  const raw = await gql(LOCATIONS_QUERY, {})
  if (raw === null) return null
  const parsed = locationsResponse.safeParse(raw)
  return parsed.success ? parsed.data.data.locations : null
}

/** Stub until the MR% definition lands (Task 0 / Task 9). */
export async function fetchMembershipRate(_boulevardLocationId: string): Promise<number | null> {
  return null
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/boulevard/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/boulevard/types.ts src/lib/boulevard/client.ts src/__tests__/boulevard/client.test.ts .env.example src/lib/env.ts
git commit -m "feat(rock-2): boulevard admin client (auth, isolated query, zod, timeout)"
```

---

## Task 4: Surface the mapping on listing detail + access-control guard

**Files:**
- Modify: `src/lib/listing-detail.ts`
- Create: `src/lib/kpi/access.ts`, `src/__tests__/kpi/access-control.test.ts`

**Interfaces:**
- Produces:
  - `ListingDetailLocation` gains `boulevardLocationId: string | null` and `boulevardMappingStatus: 'unconfirmed' | 'confirmed' | 'not_connected'`.
  - `canFetchBoulevard(listingStatus: string, mappingStatus: string): boolean` — true only when `listingStatus === 'active'` AND `mappingStatus === 'confirmed'`.

- [ ] **Step 1: Write the failing test for the guard**

```ts
import { describe, it, expect } from "vitest"
import { canFetchBoulevard } from "@/lib/kpi/access"

describe("canFetchBoulevard", () => {
  it("allows only active + confirmed", () => {
    expect(canFetchBoulevard("active", "confirmed")).toBe(true)
  })
  it.each([
    ["draft", "confirmed"],
    ["pending", "confirmed"],
    ["sold", "confirmed"],
    ["active", "unconfirmed"],
    ["active", "not_connected"],
  ])("blocks %s / %s", (listing, mapping) => {
    expect(canFetchBoulevard(listing, mapping)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/access-control.test.ts`
Expected: FAIL — `access.ts` does not exist.

- [ ] **Step 3: Implement `src/lib/kpi/access.ts`**

```ts
/** The Rock 2 safety invariant: real Boulevard dollars only for listed + confirmed-mapped locations. */
export function canFetchBoulevard(listingStatus: string, mappingStatus: string): boolean {
  return listingStatus === "active" && mappingStatus === "confirmed"
}
```

- [ ] **Step 4: Surface the columns in `listing-detail.ts`**

In `ListingDetailLocation` interface add:

```ts
  boulevardLocationId: string | null
  boulevardMappingStatus: 'unconfirmed' | 'confirmed' | 'not_connected'
```

In the `locations.map(...)` return object add:

```ts
      boulevardLocationId: loc.boulevardLocationId ?? null,
      boulevardMappingStatus: loc.boulevardMappingStatus,
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/__tests__/kpi/access-control.test.ts && npx tsc --noEmit`
Expected: PASS (test) + 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpi/access.ts src/__tests__/kpi/access-control.test.ts src/lib/listing-detail.ts
git commit -m "feat(rock-2): expose boulevard mapping on detail + access-control guard"
```

---

## Task 5: Swap mock revenue for real Boulevard sales (with fallback)

**Files:**
- Modify: `src/lib/kpi/fetch.ts`, `src/lib/kpi/schema.ts`
- Test: `src/__tests__/kpi/revenue.test.ts`

**Interfaces:**
- Consumes: `fetchMonthlySales` (Task 3), `canFetchBoulevard` (Task 4).
- Produces: `fetchLocationRevenue(args: { listingStatus: string; mappingStatus: string; boulevardLocationId: string | null }): Promise<{ metric: KpiMetric; ttmCents: number } | null>` — `null` = "not connected".
- `KpiMetric` gains `source: 'boulevard' | 'sample'` and `asOf: string` (ISO) — additive, optional-safe.

- [ ] **Step 1: Add fields to `KpiMetric` in `src/lib/kpi/schema.ts`**

Add `source: z.enum(["boulevard", "sample"]).optional()` and keep existing `updatedAt`. (If `KpiMetric` is a plain type, add `source?: 'boulevard' | 'sample'`.)

- [ ] **Step 2: Write the failing test (mock the boulevard client)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/boulevard/client", () => ({
  fetchMonthlySales: vi.fn(),
}))

describe("fetchLocationRevenue", () => {
  beforeEach(() => vi.resetModules())

  it("returns null (not connected) when mapping is not confirmed", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "unconfirmed", boulevardLocationId: "b1" })
    expect(r).toBeNull()
  })

  it("builds a revenue metric + TTM from Boulevard monthly sales", async () => {
    const { fetchMonthlySales } = await import("@/lib/boulevard/client")
    vi.mocked(fetchMonthlySales).mockResolvedValue([
      { month: "2026-04", sales: 1000000 },
      { month: "2026-05", sales: 1200000 },
    ])
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", boulevardLocationId: "b1" })
    expect(r?.ttmCents).toBe(2200000)
    expect(r?.metric.lastMonth).toBe(1200000)
    expect(r?.metric.source).toBe("boulevard")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/revenue.test.ts`
Expected: FAIL — `fetchLocationRevenue` not exported.

- [ ] **Step 4: Implement `fetchLocationRevenue` in `src/lib/kpi/fetch.ts`**

Add near the top: `import { fetchMonthlySales } from "@/lib/boulevard/client"` and `import { canFetchBoulevard } from "./access"`. Then:

```ts
export async function fetchLocationRevenue(args: {
  listingStatus: string
  mappingStatus: string
  boulevardLocationId: string | null
}): Promise<{ metric: KpiMetric; ttmCents: number } | null> {
  if (!args.boulevardLocationId || !canFetchBoulevard(args.listingStatus, args.mappingStatus)) {
    return null // "not connected"
  }
  const series = await fetchMonthlySales(args.boulevardLocationId, 12)
  if (!series || series.length === 0) return null
  const ttmCents = series.reduce((s, m) => s + m.sales, 0)
  const last = series[series.length - 1].sales
  const prev = series.length > 1 ? series[series.length - 2].sales : last
  const momChange = prev > 0 ? (last - prev) / prev : 0
  return {
    ttmCents,
    metric: {
      lastMonth: last,
      momChange,
      trend: series.map((m) => ({ month: m.month, value: m.sales })),
      updatedAt: new Date().toISOString(),
      source: "boulevard",
    },
  }
}
```

> Mock path: leave `fetchLocationKpi`/`mockLocationKpi` in place but only reachable when `process.env.KPI_USE_MOCK === "1"`. The detail page (Task 7) calls `fetchLocationRevenue` for the real revenue card; mock is no longer the default.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/__tests__/kpi/revenue.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpi/fetch.ts src/lib/kpi/schema.ts src/__tests__/kpi/revenue.test.ts
git commit -m "feat(rock-2): real Boulevard revenue with not-connected fallback"
```

---

## Task 6: Mapping server actions + approval-queue gate

**Files:**
- Create: `src/lib/boulevard/mapping-actions.ts`, `src/__tests__/boulevard/mapping-actions.test.ts`
- Modify: the admin approve path (`src/components/admin/ModerationQueue.tsx` + its action) and `AdminListingCard.tsx`

**Interfaces:**
- Produces:
  - `setLocationMapping(locationId, { boulevardLocationId, status }): Promise<{ ok: boolean; error?: string }>` — admin-only; sets `boulevard_location_id` + `boulevard_mapping_status`.
  - `getUnresolvedSalonLocations(listingId): Promise<{ id: string; name: string }[]>` — salon locations still `unconfirmed`.
  - Approve action rejects with a clear error if any salon location is `unconfirmed`.

- [ ] **Step 1: Write the failing test for the gate helper**

```ts
import { describe, it, expect, vi } from "vitest"
const rows = [
  { id: "l1", name: "A", locationType: "salon", boulevardMappingStatus: "confirmed" },
  { id: "l2", name: "B", locationType: "salon", boulevardMappingStatus: "unconfirmed" },
  { id: "l3", name: "T", locationType: "territory", boulevardMappingStatus: "unconfirmed" },
]
import { unresolvedSalonLocations } from "@/lib/boulevard/mapping-actions"

describe("unresolvedSalonLocations", () => {
  it("returns only unconfirmed SALON locations (territories exempt)", () => {
    expect(unresolvedSalonLocations(rows).map((r) => r.id)).toEqual(["l2"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/boulevard/mapping-actions.test.ts`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Implement the pure helper + actions**

In `src/lib/boulevard/mapping-actions.ts`:

```ts
"use server"
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"

type LocRow = { id: string; name: string; locationType: string; boulevardMappingStatus: string }

/** Pure: salon locations that still block approval. */
export function unresolvedSalonLocations(rows: LocRow[]): LocRow[] {
  return rows.filter((r) => r.locationType === "salon" && r.boulevardMappingStatus === "unconfirmed")
}

async function requireAdmin() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") throw new Error("Forbidden")
}

export async function setLocationMapping(
  locationId: string,
  input: { boulevardLocationId: string | null; status: "confirmed" | "not_connected" }
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin()
  if (input.status === "confirmed" && !input.boulevardLocationId) {
    return { ok: false, error: "A Boulevard location is required to confirm." }
  }
  await db.update(listingLocations)
    .set({ boulevardLocationId: input.boulevardLocationId, boulevardMappingStatus: input.status })
    .where(eq(listingLocations.id, locationId))
  return { ok: true }
}
```

- [ ] **Step 4: Wire the gate into the approve action**

In the admin approve action, before transitioning a listing to `active`, load its locations and call `unresolvedSalonLocations`. If non-empty, return an error like `"Confirm Boulevard mapping for: <names>"` and do not approve.

```ts
const locs = await db.select({
  id: listingLocations.id, name: listingLocations.name,
  locationType: listingLocations.locationType, boulevardMappingStatus: listingLocations.boulevardMappingStatus,
}).from(listingLocations).where(eq(listingLocations.listingId, listingId))
const blocking = unresolvedSalonLocations(locs)
if (blocking.length > 0) {
  return { ok: false, error: `Confirm Boulevard mapping for: ${blocking.map((b) => b.name).join(", ")}` }
}
```

- [ ] **Step 5: Add the confirm UI to `AdminListingCard`/`ModerationQueue`**

For each salon location on a pending listing, render a `<select>` of Boulevard locations (from `listBoulevardLocations`, prefilled to the name-match suggestion) plus a "Not connected" option; on change call `setLocationMapping`. Use existing hs-red button styling. (Pure-logic already tested; this is wiring.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/__tests__/boulevard/mapping-actions.test.ts && npx tsc --noEmit`
Expected: PASS + 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boulevard/mapping-actions.ts src/__tests__/boulevard/mapping-actions.test.ts src/components/admin/
git commit -m "feat(rock-2): mapping actions + approval gate (block approve until salon mappings resolved)"
```

---

## Task 7: Admin Boulevard mappings screen (backfill) + render real revenue

**Files:**
- Create: `src/app/admin/boulevard/page.tsx`, `src/components/admin/BoulevardMappings.tsx`
- Modify: `src/app/admin/layout.tsx` (nav link), `src/components/listing-detail/FinancialsGrid.tsx`, KPI section/page to call `fetchLocationRevenue`

**Interfaces:**
- Consumes: `setLocationMapping`, `listBoulevardLocations`, `suggestBoulevardMatch`, `fetchLocationRevenue`.

- [ ] **Step 1: Build the mappings screen (server component + client table)**

`src/app/admin/boulevard/page.tsx` (admin-guarded like `admin/users/page.tsx`): load all salon `listing_locations` with their listing title + status, load `listBoulevardLocations()`, compute suggestions with `suggestBoulevardMatch`, pass to `<BoulevardMappings>`. The client component renders a table (location, listing, suggested match, status) with a confirm/override/clear control calling `setLocationMapping`. Empty/loading states match existing admin styling.

- [ ] **Step 2: Add nav link**

In `src/app/admin/layout.tsx`, add `<NavLink href="/admin/boulevard">Boulevard</NavLink>` to the left nav-links group.

- [ ] **Step 3: Render real revenue + "not connected" on the detail page**

Where the listing detail builds KPI/financials, call `fetchLocationRevenue` per confirmed salon location; sum `ttmCents` into the `FinancialsGrid` "TTM Revenue" card. When it returns `null`, render "Not connected to Boulevard" instead of a number. Keep `ttmProfit` (manual) untouched.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, sign in as admin, open `/admin/boulevard`, confirm a mapping, then open that listing's detail and verify the TTM Revenue reflects the Boulevard value (or "Not connected" when unmapped). With `KPI_USE_MOCK` unset, no mock revenue should appear.

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: 0 errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/boulevard/ src/components/admin/BoulevardMappings.tsx src/app/admin/layout.tsx src/components/listing-detail/FinancialsGrid.tsx src/lib/listing-detail.ts src/components/kpi/
git commit -m "feat(rock-2): admin boulevard mappings screen + real revenue on detail"
```

---

## Task 8: Caching, freshness, source badges, truthful copy + MR%/sample stubs

**Files:**
- Modify: `src/lib/kpi/fetch.ts` (cache wrap), `src/components/kpi/KpiCard.tsx`/`KpiSection.tsx`, `src/components/listing-detail/FinancialsGrid.tsx`, the listing `page.tsx` "live data" copy

- [ ] **Step 1: Cache the revenue fetch (daily)**

Wrap the Boulevard-backed fetch in `unstable_cache` with `{ revalidate: 86400, tags: ["boulevard-revenue"] }`, keyed by `boulevardLocationId`. (Mirror the existing `unstable_cache` usage; the test mock from Rock 1 already pass-throughs `unstable_cache`.)

- [ ] **Step 2: Add "as of" + source badge to KPI/financial cards**

Revenue card: small "Boulevard" badge + "as of {date}" from `metric.asOf`/`updatedAt`. New Clients & Bookings: badge "Sample — not live". MR%: badge "Pending" (stub). Seller-entered cards (Asking Price, Profit): no Boulevard badge.

- [ ] **Step 3: Make the "live data" copy truthful**

In the listing `page.tsx`, change the section copy so it claims "live" only for the Boulevard-sourced fields (e.g., "Live revenue from Boulevard · other metrics coming soon").

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpi/ src/components/kpi/ src/components/listing-detail/FinancialsGrid.tsx src/app/listings/
git commit -m "feat(rock-2): daily cache, as-of freshness, source badges, truthful copy"
```

---

## Task 9: MR% — implement once Task 0 definition lands (deferred)

**Blocked by Task 0** (MR% definition from Haley/Austin: numerator, denominator, time window). Until then `fetchMembershipRate` returns `null` and the MR% card shows "Pending."

When the definition arrives:
- [ ] Implement the membership query in `client.ts` (`fetchMembershipRate`) per the confirmed definition, Zod-validated.
- [ ] Wire it into the KPI section's membership card (replace the stub/sample badge with real value + "Boulevard" badge + "as of").
- [ ] Add a unit test mirroring the revenue test (mock the client; assert value + source).
- [ ] `npx tsc --noEmit && npm test`; commit `feat(rock-2): real membership rate (MR%) from Boulevard`.

---

## Self-Review

**Spec coverage:** Task 0 (parallel human dep) — noted, Task 9 gated on it ✓. Task 1 join key → Tasks 1,2,6,7 ✓. Task 2 client → Task 3 ✓. Task 3 real revenue + fallback → Tasks 4,5,7 ✓. Task 4 MR% → Task 9 ✓. Task 5 caching/freshness → Task 8 ✓. Task 6 truthful copy + source signal → Task 8 ✓. Access control rides along → Task 4 (+ enforced in 5/6/7) ✓. New Clients/Bookings "sample" + MR% "pending" → Task 8 ✓. Profit stays manual → enforced in 5/7 ✓. Mock dev-only flag → Task 5/7 ✓.

**Known-unknowns (not placeholders):** the Boulevard GraphQL documents + auth header in Task 3 are isolated constants explicitly flagged for live iteration (spec D1); the MR% query in Task 9 is gated on Task 0. These are genuine external dependencies, called out as such.

**Type consistency:** `MonthlySales = { month; sales (cents) }` produced in Task 3, consumed in Task 5; `canFetchBoulevard(listingStatus, mappingStatus)` defined in Task 4, used in Task 5; `boulevardMappingStatus` enum identical across schema (Task 1), detail (Task 4), actions (Task 6).
