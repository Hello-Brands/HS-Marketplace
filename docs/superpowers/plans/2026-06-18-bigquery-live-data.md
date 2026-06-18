# BigQuery Live Data Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-functional Boulevard integration with BigQuery as the source of real per-location Net Sales (YTD) and MCR (YTD) for marketplace listings.

**Architecture:** Keep the existing location-mapping + admin-approval-gate + cached-fetch architecture and swap only the data source. Boulevard's GraphQL client is replaced by a BigQuery client that runs two pre-aggregated queries (one per metric), each cached daily and returning a `Map<LOCATION_NAME, value>`. Reusable, source-agnostic logic (name matching, the approval gate, the mapping server action, the admin UI) is moved out of `src/lib/boulevard/` into `src/lib/data/` and renamed. The Boulevard directory is deleted.

**Tech Stack:** Next.js (App Router, server components/actions), Drizzle ORM (Postgres/Neon, push-managed), `@google-cloud/bigquery`, Vitest 4, Zod, Tailwind.

## Global Constraints

- All data-source code is `server-only` — credentials must never reach the client bundle.
- DB schema changes are applied with `npm run db:push` (drizzle-kit push). Do NOT write SQL migration files by hand. `drizzle.config.ts` reads `DATABASE_URL_DIRECT`.
- Money is stored and compared in **cents** (integer). BigQuery returns **dollars** → convert with `Math.round(dollars * 100)`.
- MCR is a **percentage number** (e.g. `38.0`), already `* 100` in the SQL.
- The safety invariant is unchanged: real data shows ONLY when `listingStatus === "active" && mappingStatus === "confirmed"`.
- Metric window is **YTD** (Jan 1 → today), not TTM. Revenue card label is exactly **"Net Sales (YTD, Cash + Credit)"**.
- MCR definition is **new members ÷ prospects, laser excluded** (Prince's data-mart definition).
- The `KpiMetric.source` value for live data is the string `"bigquery"`.
- New Clients and Bookings KPI tiles are **hidden** (no source). Do not render them.
- Test runner: `npm test` (`vitest run`). Tests live in `src/__tests__/**/*.test.ts`. Mock `server-only` with `vi.mock("server-only", () => ({}))` in any test that imports a `server-only` module.
- Tests must NOT hit live BigQuery — mock the `@google-cloud/bigquery` module.
- Commit after each task with the shown message.

## File map

**Create:**
- `src/lib/bigquery/client.ts` — BigQuery client singleton + raw query helper (server-only)
- `src/lib/bigquery/queries.ts` — `getNetSalesByLocation`, `getMcrByLocation`, `listLocationNames` (cached)
- `src/lib/data/match.ts` — moved from `boulevard/match.ts`, renamed source-agnostic
- `src/lib/data/mapping.ts` — moved from `boulevard/mapping.ts`
- `src/lib/data/mapping-actions.ts` — moved from `boulevard/mapping-actions.ts`
- `src/components/admin/DataMappings.tsx` — renamed from `BoulevardMappings.tsx`
- `src/app/admin/data/page.tsx` — renamed from `admin/boulevard/page.tsx`
- `src/__tests__/bigquery/queries.test.ts`, `src/__tests__/data/match.test.ts`, `src/__tests__/data/mapping.test.ts`

**Modify:**
- `src/db/schema/listings.ts` — rename two columns
- `src/lib/kpi/access.ts` — rename gate fn
- `src/lib/kpi/fetch.ts` — source from BigQuery
- `src/lib/kpi/schema.ts` — `source` enum
- `src/lib/kpi/badges.ts` — `"bigquery"` is live
- `src/lib/listing-detail.ts` — rename location fields
- `src/components/listing-detail/FinancialsGrid.tsx` — relabel card
- `src/components/kpi/KpiSection.tsx` — hide New Clients/Bookings, new copy
- `src/components/kpi/KpiCardRow.tsx` — hide New Clients/Bookings (verify during Task 9)
- `src/app/listings/[id]/page.tsx` — wire BigQuery revenue
- `src/lib/admin/actions.ts` — import path + field rename
- `src/app/admin/layout.tsx` — nav label/href
- `.env.example`, `.gitignore`, `package.json` (dep)

**Delete:**
- `src/lib/boulevard/` (entire dir: `client.ts`, `types.ts`, and the three moved files once relocated)
- `src/__tests__/boulevard/` (entire dir: `client.test.ts`, `membership.test.ts`, `match.test.ts`, `mapping.test.ts`)

---

### Task 1: Dependency, env, and gitignore setup

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: env vars `BIGQUERY_PROJECT_ID`, `BIGQUERY_CREDENTIALS`, `GOOGLE_APPLICATION_CREDENTIALS`; the `@google-cloud/bigquery` package.

- [ ] **Step 1: Install the BigQuery client**

Run: `npm install @google-cloud/bigquery`
Expected: `@google-cloud/bigquery` appears under `dependencies` in `package.json`; install exits 0.

- [ ] **Step 2: Replace Boulevard env vars in `.env.example`**

Find the Boulevard block (currently lines ~28-30):
```
# Boulevard Admin API (Rock 2 — real KPI/financial data). SERVER-ONLY.
BOULEVARD_API_URL=https://sandbox.joinblvd.com/api/2020-01/admin
BOULEVARD_API_KEY=your-boulevard-admin-api-key
```
Replace with:
```
# BigQuery (real KPI/financial data). SERVER-ONLY. Never expose to the client.
BIGQUERY_PROJECT_ID=even-affinity-388602
# Local dev: path to the downloaded service-account key file (gitignored).
GOOGLE_APPLICATION_CREDENTIALS=./.secrets/bq-key.json
# Vercel / prod: full service-account JSON as a single-line string (use instead of the path).
# BIGQUERY_CREDENTIALS={"type":"service_account",...}
```

- [ ] **Step 3: Gitignore the key + secrets dir**

Add to `.gitignore` (if not already present):
```
# BigQuery / GCP service-account keys
.secrets/
*-bq-key.json
```

- [ ] **Step 4: Verify the key is not tracked**

Run: `git status --porcelain .secrets/ 2>/dev/null; git check-ignore .secrets/bq-key.json`
Expected: `git check-ignore` prints `.secrets/bq-key.json` (meaning it is ignored). No `.secrets/` files appear in `git status`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "chore(rock-2): add @google-cloud/bigquery dep + env/gitignore for BigQuery"
```

---

### Task 2: BigQuery client (server-only singleton)

**Files:**
- Create: `src/lib/bigquery/client.ts`

**Interfaces:**
- Produces:
  - `getBigQueryClient(): BigQuery | null` — returns a cached client, or `null` if no creds configured.
  - `runQuery<T>(sql: string): Promise<T[] | null>` — runs SQL, returns rows or `null` on missing-creds/error.

- [ ] **Step 1: Write the client**

Create `src/lib/bigquery/client.ts`:
```typescript
import "server-only"
import { BigQuery } from "@google-cloud/bigquery"

let cached: BigQuery | null | undefined

/**
 * Lazily build a BigQuery client.
 * Prefers BIGQUERY_CREDENTIALS (JSON string, for Vercel); falls back to
 * GOOGLE_APPLICATION_CREDENTIALS (file path, local dev) which the SDK reads
 * automatically. Returns null when no project / creds are configured so callers
 * can degrade to "not connected".
 */
export function getBigQueryClient(): BigQuery | null {
  if (cached !== undefined) return cached

  const projectId = process.env.BIGQUERY_PROJECT_ID
  if (!projectId) {
    cached = null
    return cached
  }

  const inlineJson = process.env.BIGQUERY_CREDENTIALS
  if (inlineJson) {
    try {
      cached = new BigQuery({ projectId, credentials: JSON.parse(inlineJson) })
    } catch (err) {
      console.warn("[bigquery] BIGQUERY_CREDENTIALS is not valid JSON:", err)
      cached = null
    }
    return cached
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    cached = new BigQuery({ projectId }) // SDK reads the key file from the env path
    return cached
  }

  cached = null
  return cached
}

/** Run a SQL string and return typed rows, or null on missing creds / any error. */
export async function runQuery<T>(sql: string): Promise<T[] | null> {
  const client = getBigQueryClient()
  if (!client) return null
  try {
    const [rows] = await client.query({ query: sql })
    return rows as T[]
  } catch (err) {
    console.warn("[bigquery] query failed:", err)
    return null
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `src/lib/bigquery/client.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/bigquery/client.ts
git commit -m "feat(rock-2): BigQuery client singleton (server-only, creds via JSON or path)"
```

---

### Task 3: BigQuery queries — Net Sales, MCR, location list (cached)

**Files:**
- Create: `src/lib/bigquery/queries.ts`
- Test: `src/__tests__/bigquery/queries.test.ts`

**Interfaces:**
- Consumes: `runQuery` from `src/lib/bigquery/client.ts`.
- Produces:
  - `getNetSalesByLocation(): Promise<Map<string, number>>` — LOCATION_NAME → **cents**. Empty map on error.
  - `getMcrByLocation(): Promise<Map<string, number>>` — LOCATION_NAME → **mcr_pct** (number). Empty map on error.
  - `listLocationNames(): Promise<string[] | null>` — distinct LOCATION_NAMEs for the admin dropdown; `null` if not configured.
  - Pure helpers (exported for testing): `rowsToNetSalesMap(rows)`, `rowsToMcrMap(rows)`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/bigquery/queries.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { rowsToNetSalesMap, rowsToMcrMap } from "@/lib/bigquery/queries"

describe("rowsToNetSalesMap", () => {
  it("converts dollars to integer cents keyed by LOCATION_NAME", () => {
    const map = rowsToNetSalesMap([
      { LOCATION_NAME: "Sugar House", cash_plus_credit: 168000.55 },
      { LOCATION_NAME: "Decatur", cash_plus_credit: 42000 },
    ])
    expect(map.get("Sugar House")).toBe(16800055)
    expect(map.get("Decatur")).toBe(4200000)
  })

  it("skips rows with null/blank location name", () => {
    const map = rowsToNetSalesMap([{ LOCATION_NAME: null, cash_plus_credit: 100 }])
    expect(map.size).toBe(0)
  })
})

describe("rowsToMcrMap", () => {
  it("maps mcr_pct as a number keyed by LOCATION_NAME", () => {
    const map = rowsToMcrMap([{ LOCATION_NAME: "Sugar House", mcr_pct: 38 }])
    expect(map.get("Sugar House")).toBe(38)
  })

  it("treats null mcr_pct as 0", () => {
    const map = rowsToMcrMap([{ LOCATION_NAME: "X", mcr_pct: null }])
    expect(map.get("X")).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/bigquery/queries.test.ts`
Expected: FAIL — `rowsToNetSalesMap` / `rowsToMcrMap` not exported.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bigquery/queries.ts`:
```typescript
import "server-only"
import { unstable_cache } from "next/cache"
import { runQuery } from "./client"

type NetSalesRow = { LOCATION_NAME: string | null; cash_plus_credit: number | null }
type McrRow = { LOCATION_NAME: string | null; mcr_pct: number | null }
type NameRow = { LOCATION_NAME: string | null }

const NET_SALES_SQL = `
  SELECT LOCATION_NAME, ROUND(SUM(TRANSACTION_AMOUNT), 2) AS cash_plus_credit
  FROM \`even-affinity-388602.snowflake_data.vw_order_payments_raw\`
  WHERE CREATED_ON >= DATE_TRUNC(CURRENT_DATE(), YEAR)
  GROUP BY LOCATION_NAME
  ORDER BY cash_plus_credit DESC`

const MCR_SQL = `
  SELECT LOCATION_NAME,
    ROUND(SAFE_DIVIDE(SUM(NON_LASER_NEW_MEMBERS), SUM(NON_LASER_PROSPECTS)) * 100, 1) AS mcr_pct
  FROM \`even-affinity-388602.data_mart_for_tools.vw_mcr_data_agg_raw\`
  WHERE APPOINTMENT_DATE >= DATE_TRUNC(CURRENT_DATE(), YEAR)
  GROUP BY LOCATION_NAME
  ORDER BY mcr_pct DESC`

const NAMES_SQL = `
  SELECT DISTINCT LOCATION_NAME
  FROM \`even-affinity-388602.snowflake_data.vw_order_payments_raw\`
  WHERE LOCATION_NAME IS NOT NULL
  ORDER BY LOCATION_NAME`

/** Pure: dollars → integer cents, keyed by LOCATION_NAME. Exported for tests. */
export function rowsToNetSalesMap(rows: NetSalesRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!r.LOCATION_NAME) continue
    map.set(r.LOCATION_NAME, Math.round((r.cash_plus_credit ?? 0) * 100))
  }
  return map
}

/** Pure: mcr_pct as a number, keyed by LOCATION_NAME. Exported for tests. */
export function rowsToMcrMap(rows: McrRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!r.LOCATION_NAME) continue
    map.set(r.LOCATION_NAME, r.mcr_pct ?? 0)
  }
  return map
}

const cachedNetSales = unstable_cache(
  async () => {
    const rows = await runQuery<NetSalesRow>(NET_SALES_SQL)
    return Array.from(rowsToNetSalesMap(rows ?? []).entries())
  },
  ["bq-net-sales-ytd"],
  { revalidate: 86400, tags: ["bq-net-sales"] }
)

const cachedMcr = unstable_cache(
  async () => {
    const rows = await runQuery<McrRow>(MCR_SQL)
    return Array.from(rowsToMcrMap(rows ?? []).entries())
  },
  ["bq-mcr-ytd"],
  { revalidate: 86400, tags: ["bq-mcr"] }
)

export async function getNetSalesByLocation(): Promise<Map<string, number>> {
  return new Map(await cachedNetSales())
}

export async function getMcrByLocation(): Promise<Map<string, number>> {
  return new Map(await cachedMcr())
}

export async function listLocationNames(): Promise<string[] | null> {
  const rows = await runQuery<NameRow>(NAMES_SQL)
  if (rows === null) return null
  return rows.map((r) => r.LOCATION_NAME).filter((n): n is string => !!n)
}
```

> Note: `unstable_cache` caches arrays (it serializes return values), so we store `Array.from(map.entries())` and rebuild the `Map` in the exported wrappers. This is NOT the Next.js you know — if `npx tsc` flags `unstable_cache`, check `node_modules/next/dist/docs/` for the current caching API before changing the pattern (the existing `src/lib/kpi/fetch.ts` uses the same import, so mirror whatever it does).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/bigquery/queries.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no new errors)
```bash
git add src/lib/bigquery/queries.ts src/__tests__/bigquery/queries.test.ts
git commit -m "feat(rock-2): BigQuery YTD net-sales/MCR queries (cached daily, dollars->cents)"
```

---

### Task 4: Schema rename — source-agnostic mapping columns

**Files:**
- Modify: `src/db/schema/listings.ts:85-90`

**Interfaces:**
- Produces: on `listing_locations`, columns `bqLocationName` (db `bq_location_name`) and `dataMappingStatus` (db `data_mapping_status`, same enum + default).

- [ ] **Step 1: Edit the schema**

In `src/db/schema/listings.ts`, replace the Boulevard column block:
```typescript
  // Boulevard join key (Rock 2). Real KPI/financials are fetched ONLY when
  // boulevardMappingStatus === "confirmed". Suggested by name match, human-confirmed.
  boulevardLocationId: text("boulevard_location_id"),
  boulevardMappingStatus: text("boulevard_mapping_status", {
    enum: ["unconfirmed", "confirmed", "not_connected"],
  }).default("unconfirmed").notNull(),
```
with:
```typescript
  // BigQuery join key. Stores the matched LOCATION_NAME. Real KPI/financials are
  // fetched ONLY when dataMappingStatus === "confirmed". Suggested by name match,
  // human-confirmed in the admin Data Mappings screen.
  bqLocationName: text("bq_location_name"),
  dataMappingStatus: text("data_mapping_status", {
    enum: ["unconfirmed", "confirmed", "not_connected"],
  }).default("unconfirmed").notNull(),
```

- [ ] **Step 2: Push the schema change**

Run: `npm run db:push`
Expected: drizzle-kit reports renaming/altering `listing_locations`. If prompted whether columns were renamed vs created+dropped, choose **rename** for both (`boulevard_location_id` → `bq_location_name`, `boulevard_mapping_status` → `data_mapping_status`) to preserve existing mapping data.

- [ ] **Step 3: Verify columns exist**

Run: `npm run db:studio` is interactive; instead confirm via a quick check — run `npx tsc --noEmit` after Task 5+ wiring. For now, confirm drizzle push exited 0 and printed the two column changes.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/listings.ts drizzle/
git commit -m "feat(rock-2): rename listing_locations mapping cols to bq_location_name/data_mapping_status"
```

---

### Task 5: Rename the access gate

**Files:**
- Modify: `src/lib/kpi/access.ts`
- Test: `src/__tests__/kpi/access-control.test.ts` (update references)

**Interfaces:**
- Produces: `canFetchLiveData(listingStatus: string, mappingStatus: string): boolean` (active + confirmed).

- [ ] **Step 1: Rewrite access.ts**

Replace the entire contents of `src/lib/kpi/access.ts`:
```typescript
/** Safety invariant: real live dollars/metrics only for listed + confirmed-mapped locations. */
export function canFetchLiveData(listingStatus: string, mappingStatus: string): boolean {
  return listingStatus === "active" && mappingStatus === "confirmed"
}
```

- [ ] **Step 2: Update its test**

In `src/__tests__/kpi/access-control.test.ts`, replace every `canFetchBoulevard` with `canFetchLiveData` (import and call sites). Keep all assertions identical.

- [ ] **Step 3: Run test**

Run: `npx vitest run src/__tests__/kpi/access-control.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/kpi/access.ts src/__tests__/kpi/access-control.test.ts
git commit -m "refactor(rock-2): rename canFetchBoulevard -> canFetchLiveData"
```

---

### Task 6: KPI schema + badges — `"bigquery"` source

**Files:**
- Modify: `src/lib/kpi/schema.ts:14`
- Modify: `src/lib/kpi/badges.ts`
- Test: `src/__tests__/kpi/badges.test.ts` (update)

**Interfaces:**
- Produces: `KpiMetric.source` accepts `"bigquery" | "sample"`; `kpiBadge` returns `"live"` for bigquery-sourced revenue/membership.

- [ ] **Step 1: Update the source enum**

In `src/lib/kpi/schema.ts`, change line 14 from:
```typescript
  source: z.enum(["boulevard", "sample"]).optional(),
```
to:
```typescript
  source: z.enum(["bigquery", "sample"]).optional(),
```

- [ ] **Step 2: Update badges.ts**

Replace the body of `src/lib/kpi/badges.ts`:
```typescript
import type { KpiData, KpiMetric } from "./schema"

export type KpiBadge = "live" | "sample" | "pending"

/** Honest per-card badge: only BigQuery-sourced revenue and MCR are "live". */
export function kpiBadge(key: keyof KpiData, metric: KpiMetric): KpiBadge {
  if ((key === "revenue" || key === "membershipConversion") && metric.source === "bigquery") return "live"
  if (key === "membershipConversion") return "pending"
  return "sample"
}
```

- [ ] **Step 3: Update badges test**

In `src/__tests__/kpi/badges.test.ts`, replace every `source: "boulevard"` with `source: "bigquery"`. Keep assertions identical.

- [ ] **Step 4: Run test**

Run: `npx vitest run src/__tests__/kpi/badges.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kpi/schema.ts src/lib/kpi/badges.ts src/__tests__/kpi/badges.test.ts
git commit -m "refactor(rock-2): KPI source 'boulevard' -> 'bigquery'"
```

---

### Task 7: Rewrite the KPI fetch layer to source from BigQuery

**Files:**
- Modify: `src/lib/kpi/fetch.ts`
- Test: `src/__tests__/kpi/revenue.test.ts`, `src/__tests__/kpi/membership.test.ts` (rewrite)

**Interfaces:**
- Consumes: `getNetSalesByLocation`, `getMcrByLocation` (Task 3); `canFetchLiveData` (Task 5).
- Produces (signatures CHANGE — callers in Task 10/11 depend on these exact shapes):
  - `fetchLocationRevenue(args: { listingStatus: string; mappingStatus: string; bqLocationName: string | null }): Promise<{ metric: KpiMetric; ytdCents: number } | null>`
  - `fetchLocationMembership(args: { listingStatus: string; mappingStatus: string; bqLocationName: string | null }): Promise<KpiMetric | null>`
  - `fetchLocationKpi` and `fetchBundleKpi` keep their existing signatures (still return mock for non-BigQuery tiles).

- [ ] **Step 1: Write failing tests**

Replace `src/__tests__/kpi/revenue.test.ts` with:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getNetSalesByLocation = vi.fn()
vi.mock("@/lib/bigquery/queries", () => ({ getNetSalesByLocation, getMcrByLocation: vi.fn() }))

describe("fetchLocationRevenue", () => {
  beforeEach(() => { vi.resetModules(); getNetSalesByLocation.mockReset() })

  it("returns null when not active+confirmed", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "draft", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r).toBeNull()
  })

  it("returns null when location name missing", async () => {
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: null })
    expect(r).toBeNull()
  })

  it("returns ytd cents + bigquery-sourced metric when connected", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map([["Sugar House", 16800055]]))
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Sugar House" })
    expect(r?.ytdCents).toBe(16800055)
    expect(r?.metric.source).toBe("bigquery")
    expect(r?.metric.lastMonth).toBe(16800055)
  })

  it("returns null when location absent from the BigQuery map", async () => {
    getNetSalesByLocation.mockResolvedValue(new Map())
    const { fetchLocationRevenue } = await import("@/lib/kpi/fetch")
    const r = await fetchLocationRevenue({ listingStatus: "active", mappingStatus: "confirmed", bqLocationName: "Nowhere" })
    expect(r).toBeNull()
  })
})
```

Replace `src/__tests__/kpi/membership.test.ts` with the analogous test for `fetchLocationMembership` (mock `getMcrByLocation` to return `new Map([["Sugar House", 38]])`, assert `metric.lastMonth === 38`, `metric.source === "bigquery"`, and `null` for not-connected / missing name / absent location).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/kpi/revenue.test.ts src/__tests__/kpi/membership.test.ts`
Expected: FAIL (signature mismatch / old Boulevard imports).

- [ ] **Step 3: Rewrite fetch.ts**

In `src/lib/kpi/fetch.ts`:
1. Replace the Boulevard import line
   ```typescript
   import { fetchMonthlySales, fetchMonthlyMembership } from "@/lib/boulevard/client"
   import { canFetchBoulevard } from "./access"
   ```
   with
   ```typescript
   import { getNetSalesByLocation, getMcrByLocation } from "@/lib/bigquery/queries"
   import { canFetchLiveData } from "./access"
   ```
2. Delete the `cachedMonthlySales` and `cachedMonthlyMembership` `unstable_cache` blocks (caching now lives in `queries.ts`).
3. Replace `fetchLocationMembership` and `fetchLocationRevenue` with:
```typescript
export async function fetchLocationMembership(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<KpiMetric | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null
  }
  const map = await getMcrByLocation()
  const pct = map.get(args.bqLocationName)
  if (pct === undefined) return null
  return {
    lastMonth: pct,
    momChange: 0,
    trend: [{ month: "YTD", value: pct }],
    updatedAt: new Date().toISOString(),
    source: "bigquery",
  }
}

export async function fetchLocationRevenue(args: {
  listingStatus: string
  mappingStatus: string
  bqLocationName: string | null
}): Promise<{ metric: KpiMetric; ytdCents: number } | null> {
  if (!args.bqLocationName || !canFetchLiveData(args.listingStatus, args.mappingStatus)) {
    return null // "not connected"
  }
  const map = await getNetSalesByLocation()
  const cents = map.get(args.bqLocationName)
  if (cents === undefined) return null
  return {
    ytdCents: cents,
    metric: {
      lastMonth: cents,
      momChange: 0,
      trend: [{ month: "YTD", value: cents }],
      updatedAt: new Date().toISOString(),
      source: "bigquery",
    },
  }
}
```
4. Leave `fetchLocationKpi`, `fetchBundleKpi`, `shouldUseMockData`, and the mock fallbacks unchanged (New Clients/Bookings still come from mock but get hidden in the UI in Task 9).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/kpi/revenue.test.ts src/__tests__/kpi/membership.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (will still error in callers not yet updated — that's expected; confirm errors are only in `page.tsx`, `KpiSection.tsx`, admin files handled later).
```bash
git add src/lib/kpi/fetch.ts src/__tests__/kpi/revenue.test.ts src/__tests__/kpi/membership.test.ts
git commit -m "feat(rock-2): KPI fetch sources YTD net-sales/MCR from BigQuery"
```

---

### Task 8: Move source-agnostic logic to `src/lib/data/`

**Files:**
- Create: `src/lib/data/match.ts` (from `boulevard/match.ts`)
- Create: `src/lib/data/mapping.ts` (from `boulevard/mapping.ts`)
- Create: `src/lib/data/mapping-actions.ts` (from `boulevard/mapping-actions.ts`)
- Create: `src/__tests__/data/match.test.ts`, `src/__tests__/data/mapping.test.ts`

**Interfaces:**
- Produces:
  - `normalizeName(name: string): string`
  - `suggestLocationMatch(locationName: string, candidates: { id: string; name: string }[]): { id: string; name: string; confidence: number } | null` (renamed from `suggestBoulevardMatch`; identical algorithm).
  - `unresolvedSalonLocations<T extends MappableLocation>(rows: T[]): T[]` where `MappableLocation = { id: string; name: string; locationType: string; dataMappingStatus: string }`.
  - `setLocationMapping(locationId: string, input: { bqLocationName: string | null; status: "confirmed" | "not_connected" }): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Create `src/lib/data/match.ts`**

Copy `src/lib/boulevard/match.ts` verbatim, then rename the exported `suggestBoulevardMatch` → `suggestLocationMatch` and rename its second param `blvd` → `candidates`. Keep `normalizeName`, `similarity`, the 0.5 threshold, and all logic identical.

- [ ] **Step 2: Create `src/lib/data/mapping.ts`**

Copy `src/lib/boulevard/mapping.ts`, changing the type field `boulevardMappingStatus` → `dataMappingStatus`:
```typescript
type MappableLocation = {
  id: string
  name: string
  locationType: string
  dataMappingStatus: string
}

/** Salon locations still needing a mapping decision (blocks listing approval). */
export function unresolvedSalonLocations<T extends MappableLocation>(rows: T[]): T[] {
  return rows.filter((r) => r.locationType === "salon" && r.dataMappingStatus === "unconfirmed")
}
```

- [ ] **Step 3: Create `src/lib/data/mapping-actions.ts`**

Copy `src/lib/boulevard/mapping-actions.ts`, renaming the input field and DB columns:
```typescript
"use server"
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"

export async function setLocationMapping(
  locationId: string,
  input: { bqLocationName: string | null; status: "confirmed" | "not_connected" }
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (session?.user?.role !== "admin") return { ok: false, error: "Unauthorized" }
  if (input.status === "confirmed" && !input.bqLocationName) {
    return { ok: false, error: "A location must be selected to confirm." }
  }
  await db
    .update(listingLocations)
    .set({ bqLocationName: input.bqLocationName, dataMappingStatus: input.status })
    .where(eq(listingLocations.id, locationId))
  return { ok: true }
}
```
> Verify the exact `db`/`auth` import paths against the original `boulevard/mapping-actions.ts` and copy them as-is.

- [ ] **Step 4: Create tests**

`src/__tests__/data/match.test.ts`: copy `src/__tests__/boulevard/match.test.ts`, update the import to `@/lib/data/match` and `suggestBoulevardMatch` → `suggestLocationMatch`.

`src/__tests__/data/mapping.test.ts`: copy `src/__tests__/boulevard/mapping.test.ts`, update import to `@/lib/data/mapping` and every `boulevardMappingStatus` → `dataMappingStatus`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/__tests__/data/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data/ src/__tests__/data/
git commit -m "refactor(rock-2): move name-match/mapping logic to src/lib/data (source-agnostic)"
```

---

### Task 9: Update listing detail UI (FinancialsGrid, KpiSection, page wiring)

**Files:**
- Modify: `src/lib/listing-detail.ts:8-26,71-109`
- Modify: `src/components/listing-detail/FinancialsGrid.tsx`
- Modify: `src/components/kpi/KpiSection.tsx`
- Modify: `src/components/kpi/KpiCardRow.tsx`
- Modify: `src/app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `fetchLocationRevenue`/`fetchLocationMembership` (Task 7) with `bqLocationName`.
- Produces: `ListingDetailLocation` exposes `bqLocationName: string | null` and `dataMappingStatus: 'unconfirmed' | 'confirmed' | 'not_connected'`.

- [ ] **Step 1: Update `listing-detail.ts`**

In `ListingDetailLocation` (lines 8-26), rename:
```typescript
  boulevardLocationId: string | null
  boulevardMappingStatus: 'unconfirmed' | 'confirmed' | 'not_connected'
```
to:
```typescript
  bqLocationName: string | null
  dataMappingStatus: 'unconfirmed' | 'confirmed' | 'not_connected'
```
In the `.map` (lines 71-109), rename:
```typescript
  boulevardLocationId: loc.boulevardLocationId ?? null,
  boulevardMappingStatus: loc.boulevardMappingStatus,
```
to:
```typescript
  bqLocationName: loc.bqLocationName ?? null,
  dataMappingStatus: loc.dataMappingStatus,
```

- [ ] **Step 2: Update `FinancialsGrid.tsx`**

Rename the prop `boulevardTtm` → `netSalesYtd` (type unchanged: `{ cents: number; asOf: string } | null`). In the revenue card JSX, change the label text from `TTM Revenue` to `Net Sales (YTD)`, the badge text from `Boulevard` to `Live`, and `formatPrice(boulevardTtm.cents)` → `formatPrice(netSalesYtd.cents)`, `boulevardTtm.asOf` → `netSalesYtd.asOf`. In the fallback `MetricCard`, change `label="TTM Revenue"` → `label="Net Sales (YTD)"` and `subLabel="Not connected to Boulevard"` → `subLabel="Not connected"`. Update the `boulevardTtm != null` condition to `netSalesYtd != null`.

- [ ] **Step 3: Update `page.tsx`**

In `src/app/listings/[id]/page.tsx`:
- Lines 54-68: rename `boulevardTtm` → `netSalesYtd`, and in the `fetchLocationRevenue` call replace
  ```typescript
  mappingStatus: l.boulevardMappingStatus,
  boulevardLocationId: l.boulevardLocationId,
  ```
  with
  ```typescript
  mappingStatus: l.dataMappingStatus,
  bqLocationName: l.bqLocationName,
  ```
  and `r.ttmCents` → `r.ytdCents`.
- Line 162: `<FinancialsGrid listing={listing} netSalesYtd={netSalesYtd} hasSalonLocations={salonLocations.length > 0} />`.
- Lines 182-183: replace
  ```typescript
  boulevardLocationId={primaryLocation?.boulevardLocationId ?? null}
  boulevardMappingStatus={primaryLocation?.boulevardMappingStatus}
  ```
  with
  ```typescript
  bqLocationName={primaryLocation?.bqLocationName ?? null}
  dataMappingStatus={primaryLocation?.dataMappingStatus}
  ```

- [ ] **Step 4: Update `KpiSection.tsx`**

- Rename props `boulevardLocationId` → `bqLocationName` and `boulevardMappingStatus` → `dataMappingStatus` in `KpiSectionProps` and the destructure.
- In the single-location branch, pass `bqLocationName`/`mappingStatus: dataMappingStatus` to `fetchLocationRevenue`/`fetchLocationMembership`.
- Change `const revenueLive = data.revenue?.source === "boulevard"` → `=== "bigquery"`.
- **Hide New Clients & Bookings:** before rendering, null them out so no tile shows:
  ```typescript
  data = { ...data, newClients: undefined, bookings: undefined }
  ```
  (apply right before computing `hasAnyKpi`).
- Update the copy: when `revenueLive`, `"Net Sales and MCR are live from BigQuery (year-to-date)."`; otherwise `"Live data not connected for this location."`.
- For the bundle branch copy, change `"Sample data — live metrics coming soon."` to `"Live per-location data coming soon."` and also null out `newClients`/`bookings` on `cumulative` before rendering.

- [ ] **Step 5: Verify KpiCardRow hides undefined tiles**

Read `src/components/kpi/KpiCardRow.tsx`. Confirm it only renders a card when the metric is present (e.g. `data.newClients && <Card .../>`). If it renders unconditionally, guard each tile with a truthiness check so `undefined` metrics are skipped. (No new tile types are added.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `listing-detail.ts`, `FinancialsGrid.tsx`, `KpiSection.tsx`, `page.tsx`, `KpiCardRow.tsx`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/listing-detail.ts src/components/listing-detail/FinancialsGrid.tsx src/components/kpi/KpiSection.tsx src/components/kpi/KpiCardRow.tsx "src/app/listings/[id]/page.tsx"
git commit -m "feat(rock-2): listing detail shows BigQuery Net Sales (YTD) + MCR; hide new-clients/bookings"
```

---

### Task 10: Repurpose the admin mapping screen for BigQuery

**Files:**
- Create: `src/components/admin/DataMappings.tsx` (from `BoulevardMappings.tsx`)
- Create: `src/app/admin/data/page.tsx` (from `admin/boulevard/page.tsx`)
- Modify: `src/lib/admin/actions.ts`
- Modify: `src/app/admin/layout.tsx:44`
- Delete: `src/components/admin/BoulevardMappings.tsx`, `src/app/admin/boulevard/page.tsx`

**Interfaces:**
- Consumes: `listLocationNames` (Task 3), `suggestLocationMatch` (Task 8), `setLocationMapping` (Task 8), `unresolvedSalonLocations` (Task 8).

- [ ] **Step 1: Create `DataMappings.tsx`**

Copy `BoulevardMappings.tsx` → `src/components/admin/DataMappings.tsx`. Changes:
- `Row` fields: `currentBoulevardId` → `currentLocationName`, keep `suggestedId`/`suggestedConfidence` but treat `suggestedId` as a LOCATION_NAME string.
- Props: `blvdLocations: { id: string; name: string }[]` → `locationNames: string[]`; `blvdConfigured` → `bqConfigured`.
- Import `setLocationMapping` from `@/lib/data/mapping-actions`.
- Server-action calls: `setLocationMapping(row.locationId, { bqLocationName: null, status: "not_connected" })` and `setLocationMapping(row.locationId, { bqLocationName: value, status: "confirmed" })`.
- The select/dropdown now lists `locationNames` (value = the name itself).
- Update visible copy: "Boulevard" → "BigQuery" / "Data source"; component/function name `BoulevardMappings` → `DataMappings`.

- [ ] **Step 2: Create `src/app/admin/data/page.tsx`**

Copy `admin/boulevard/page.tsx` → `src/app/admin/data/page.tsx`. Changes:
```typescript
import { listLocationNames } from "@/lib/bigquery/queries"
import { suggestLocationMatch } from "@/lib/data/match"
import { DataMappings } from "@/components/admin/DataMappings"
// ...
const [locations, names] = await Promise.all([
  db.query.listingLocations.findMany({
    where: eq(listingLocations.locationType, "salon"),
    with: { listing: { columns: { id: true, title: true, status: true } } },
  }),
  listLocationNames(),
])

const candidates = (names ?? []).map((n) => ({ id: n, name: n }))
const rows = locations.map((loc) => {
  const suggestion = names ? suggestLocationMatch(loc.name, candidates) : null
  return {
    locationId: loc.id,
    locationName: loc.name,
    listingId: loc.listing?.id ?? null,
    listingTitle: loc.listing?.title ?? null,
    listingStatus: loc.listing?.status ?? null,
    status: loc.dataMappingStatus,
    currentLocationName: loc.bqLocationName,
    suggestedId: suggestion?.id ?? null,
    suggestedConfidence: suggestion?.confidence ?? null,
  }
})
// render:
<DataMappings rows={rows} locationNames={names ?? []} bqConfigured={names !== null} />
```

- [ ] **Step 3: Update `src/lib/admin/actions.ts`**

- Change the import `unresolvedSalonLocations` from `@/lib/boulevard/mapping` → `@/lib/data/mapping`.
- In `approveListing`, where it fetches salon locations for the gate, ensure the selected field is `dataMappingStatus` (rename from `boulevardMappingStatus`) so it matches the `MappableLocation` shape.

- [ ] **Step 4: Update nav in `admin/layout.tsx`**

Line 44: change `<NavLink href="/admin/boulevard">Boulevard</NavLink>` to `<NavLink href="/admin/data">Data</NavLink>`.

- [ ] **Step 5: Delete the old files**

```bash
git rm src/components/admin/BoulevardMappings.tsx src/app/admin/boulevard/page.tsx
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in admin files.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/DataMappings.tsx src/app/admin/data/page.tsx src/lib/admin/actions.ts src/app/admin/layout.tsx
git commit -m "feat(rock-2): admin Data Mappings screen (BigQuery location-name mapping)"
```

---

### Task 11: Delete Boulevard and verify the whole suite

**Files:**
- Delete: `src/lib/boulevard/` (entire dir)
- Delete: `src/__tests__/boulevard/` (entire dir)

**Interfaces:**
- Consumes: nothing — this removes dead code. By now no non-test file imports `@/lib/boulevard/*`.

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "lib/boulevard" src/ --include=*.ts --include=*.tsx`
Expected: only matches inside `src/lib/boulevard/` and `src/__tests__/boulevard/` themselves (both about to be deleted). If anything else matches, fix that importer first.

- [ ] **Step 2: Delete the directories**

```bash
git rm -r src/lib/boulevard src/__tests__/boulevard
```

- [ ] **Step 3: Full typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: all tests pass; no test references Boulevard.

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: build succeeds (catches server/client boundary issues with `@google-cloud/bigquery`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(rock-2): remove dead Boulevard integration"
```

---

### Task 12: Live verification + memory/follow-up (REQUIRES JSON KEY)

> **Stop and request the JSON key before this task.** Place it at `.secrets/bq-key.json` (gitignored) and set `BIGQUERY_PROJECT_ID=even-affinity-388602` + `GOOGLE_APPLICATION_CREDENTIALS=./.secrets/bq-key.json` in `.env.local`.

**Files:**
- Modify: `C:\Users\Owner\.claude\projects\C--Users-Owner-Documents-HelloSugar-HS-Marketplace\memory\mr-percent-definition.md`

- [ ] **Step 1: Smoke-test a live query**

Write a throwaway script `scripts/bq-smoke.ts` that imports `listLocationNames` and `getNetSalesByLocation` and logs the counts + a sample row, run with `npx tsx scripts/bq-smoke.ts`.
Expected: prints a non-empty list of location names and at least one `(name -> cents)` entry. Then delete the script.

- [ ] **Step 2: End-to-end check in the running app**

Run: `npm run dev`. As an admin, open `/admin/data`, confirm the mapping for the "Sugar House" salon location (pick the matching LOCATION_NAME), then open that listing's detail page.
Expected: the Financials card shows a real **"Net Sales (YTD)"** dollar figure with a "Live" badge and an as-of date; the Performance section shows a real MCR; New Clients/Bookings are absent.

- [ ] **Step 3: Update the MR% memory note**

Edit `mr-percent-definition.md` to the new definition: **MCR = NON_LASER_NEW_MEMBERS ÷ NON_LASER_PROSPECTS (laser excluded), YTD, by LOCATION_NAME, from BigQuery `data_mart_for_tools.vw_mcr_data_agg_raw`.** Note it supersedes the old "÷ unique ordering clients" definition.

- [ ] **Step 4: Send Prince the app name + follow-ups**

Reply to Prince: app name is **`hs-marketplace`** (for the dedicated prod service account); request (a) month-bucketed Net Sales + MCR queries for trends, and (b) New Clients + Bookings by location if those tiles should become real.

- [ ] **Step 5: Commit**

```bash
git add docs/ "C:/Users/Owner/.claude/projects/.../memory/mr-percent-definition.md" 2>/dev/null || git add docs/
git commit -m "docs(rock-2): update MCR definition note for BigQuery source"
```

---

## Self-Review

**Spec coverage:**
- Replace Boulevard → Tasks 7, 10, 11. ✓
- BigQuery client (JSON/path creds) → Task 2. ✓
- Cached daily queries, dollars→cents → Task 3. ✓
- Schema rename via push → Task 4. ✓
- Access gate rename → Task 5. ✓
- Source enum/badges → Task 6. ✓
- Net Sales (YTD) relabel + MCR + hide New Clients/Bookings → Task 9. ✓
- Admin mapping by LOCATION_NAME → Task 10. ✓
- Security (gitignore, server-only, prod SA ask) → Tasks 1, 2, 12. ✓
- MCR definition adopted + memory update → Tasks 3, 12. ✓
- Follow-ups for Prince → Task 12. ✓
- Tests with mocked client → Tasks 3, 7, 8. ✓

**Type consistency:** `bqLocationName` / `dataMappingStatus` used uniformly across schema (4), listing-detail (9), fetch args (7), page (9), KpiSection (9), mapping (8), mapping-actions (8), admin page (10). `ytdCents` (not `ttmCents`) in fetch (7) and page (9). `source: "bigquery"` in schema (6), fetch (7), badges (6), KpiSection (9). `suggestLocationMatch` defined (8) and used (10). `setLocationMapping({ bqLocationName, status })` defined (8) and used (10). ✓

**Placeholder scan:** No TBD/TODO; each code step shows real code or an exact rename with the literal strings. ✓

**Scope:** Single cohesive integration, one plan. ✓
