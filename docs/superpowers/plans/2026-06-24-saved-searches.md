# Saved Searches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand "saved searches" so they capture the full browse filter set (including location/radius), can be re-applied from `/account/alerts`, still send match emails on the expanded criteria, and live on a browse-styled, navigable alerts page.

**Architecture:** Extend the existing typed `alerts` columns (no JSON blob). Pure helper functions handle the auto-label and the re-apply URL. The matcher (`triggerAlertMatching`) ANDs across whichever criteria are set and receives the listing's locations as data (kept pure for testing). The alerts page reuses a shared `AppHeader` (extracted from the browse header) and renders saved searches as cards.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM (Neon Postgres, push-managed), nuqs (URL filter state), Tailwind, Vitest.

## Global Constraints

- Prices are stored and compared in **cents** (matches `listings.asking_price`).
- DB is **push-managed**: apply schema changes with `npm run db:push` (no migration files). New columns must be nullable or defaulted.
- nuqs array params serialize **comma-separated**; `/browse` reads `types`/`states` via `.split(",")`. Re-apply URLs must match the param names in `useListingFilters` (`query`, `types`, `states`, `minPrice`, `maxPrice`, `sort`, `minYearsOpen`, `centerLat`, `centerLng`, `radiusMiles`, `centerLabel`).
- Email matching uses **state, type, price, min-years, radius**. `query` and `sort` are saved but **never matched**.
- Run a single test file with: `npx vitest run <path>`.
- Brand: Hello Sugar red `--hs-red-600 #dc2626`; use `hs-red-*` Tailwind classes; body font Source Sans, display font Outfit (already global).

---

### Task 1: Extend the `alerts` schema

**Files:**
- Modify: `src/db/schema/alerts.ts`

**Interfaces:**
- Produces: new nullable columns on `alerts` — `name` (text), `query` (text), `minYearsOpen` (integer), `centerLat` (doublePrecision), `centerLng` (doublePrecision), `radiusMiles` (integer), `centerLabel` (text), `sort` (text), `notifyEnabled` (boolean, default true, not null). Existing reused: `states`, `listingTypes`, `minPrice`, `maxPrice`.

- [ ] **Step 1: Add columns to the schema**

Replace the column block in `src/db/schema/alerts.ts` with:

```ts
import { pgTable, text, timestamp, json, integer, doublePrecision, boolean } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

export const alerts = pgTable("alerts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Optional user-set label; null = derive from filters
  name: text("name"),
  // Filter criteria
  query: text("query"), // free text; saved for re-apply, NOT matched
  states: json("states").$type<string[]>(),
  listingTypes: json("listing_types").$type<string[]>(),
  minPrice: integer("min_price"), // cents
  maxPrice: integer("max_price"), // cents
  minYearsOpen: integer("min_years_open"),
  sort: text("sort"), // saved for re-apply, NOT matched
  // Location / radius
  centerLat: doublePrecision("center_lat"),
  centerLng: doublePrecision("center_lng"),
  radiusMiles: integer("radius_miles"),
  centerLabel: text("center_label"),
  // Per-search email toggle
  notifyEnabled: boolean("notify_enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
})

export const alertsRelations = relations(alerts, ({ one }) => ({
  user: one(users, {
    fields: [alerts.userId],
    references: [users.id],
  }),
}))

export type Alert = typeof alerts.$inferSelect
export type NewAlert = typeof alerts.$inferInsert
```

- [ ] **Step 2: Push the schema to the database**

Run: `npm run db:push`
Expected: prompts confirm adding the new columns; completes with no errors. (New columns are nullable / defaulted, so existing rows are unaffected.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/alerts.ts
git commit -m "feat(alerts): add filter columns to alerts schema"
```

---

### Task 2: Saved-search pure helpers

**Files:**
- Create: `src/lib/saved-search.ts`
- Test: `src/__tests__/saved-search.test.ts`

**Interfaces:**
- Consumes: `Alert` type from `@/db/schema/alerts`.
- Produces:
  - `describeSavedSearch(a: SavedSearchFields): string` — human summary; `"All listings"` when nothing set.
  - `savedSearchToBrowseParams(a: SavedSearchFields): string` — query string (no leading `?`) for `/browse`, omitting unset fields.
  - `type SavedSearchFields` = `Pick<Alert, "query" | "states" | "listingTypes" | "minPrice" | "maxPrice" | "minYearsOpen" | "sort" | "centerLat" | "centerLng" | "radiusMiles" | "centerLabel">`.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/saved-search.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { describeSavedSearch, savedSearchToBrowseParams } from "@/lib/saved-search"

const empty = {
  query: null, states: null, listingTypes: null, minPrice: null, maxPrice: null,
  minYearsOpen: null, sort: null, centerLat: null, centerLng: null, radiusMiles: null, centerLabel: null,
}

describe("describeSavedSearch", () => {
  it("returns 'All listings' when nothing is set", () => {
    expect(describeSavedSearch(empty)).toBe("All listings")
  })

  it("summarizes types, price, and radius", () => {
    const s = describeSavedSearch({
      ...empty,
      listingTypes: ["suite"],
      maxPrice: 100_000_000, // $1M
      centerLat: 40.2, centerLng: -111.6, radiusMiles: 25, centerLabel: "Provo, UT",
    })
    expect(s).toContain("Suite")
    expect(s).toContain("≤$1M")
    expect(s).toContain("within 25 mi of Provo, UT")
  })

  it("collapses many states to a count", () => {
    expect(describeSavedSearch({ ...empty, states: ["UT", "AZ", "ID"] })).toContain("3 states")
  })
})

describe("savedSearchToBrowseParams", () => {
  it("omits unset fields", () => {
    expect(savedSearchToBrowseParams(empty)).toBe("")
  })

  it("serializes arrays comma-separated and includes center", () => {
    const qs = savedSearchToBrowseParams({
      ...empty,
      listingTypes: ["suite", "flagship"],
      states: ["UT"],
      minPrice: 50_000_000,
      centerLat: 40.2, centerLng: -111.6, radiusMiles: 25, centerLabel: "Provo, UT",
      sort: "distance",
    })
    const params = new URLSearchParams(qs)
    expect(params.get("types")).toBe("suite,flagship")
    expect(params.get("states")).toBe("UT")
    expect(params.get("minPrice")).toBe("50000000")
    expect(params.get("radiusMiles")).toBe("25")
    expect(params.get("centerLabel")).toBe("Provo, UT")
    expect(params.get("sort")).toBe("distance")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/__tests__/saved-search.test.ts`
Expected: FAIL — cannot resolve `@/lib/saved-search`.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/saved-search.ts`:

```ts
import type { Alert } from "@/db/schema/alerts"

export type SavedSearchFields = Pick<
  Alert,
  | "query" | "states" | "listingTypes" | "minPrice" | "maxPrice"
  | "minYearsOpen" | "sort" | "centerLat" | "centerLng" | "radiusMiles" | "centerLabel"
>

const TYPE_LABELS: Record<string, string> = {
  suite: "Suite", flagship: "Flagship", territory: "Territory", bundle: "Bundle",
}

function fmtShortPrice(cents: number): string {
  const d = cents / 100
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`
  if (d >= 1_000) return `$${Math.round(d / 1_000)}k`
  return `$${d}`
}

function priceLabel(minCents: number | null, maxCents: number | null): string | null {
  if (minCents != null && maxCents != null) return `${fmtShortPrice(minCents)}–${fmtShortPrice(maxCents)}`
  if (minCents != null) return `${fmtShortPrice(minCents)}+`
  if (maxCents != null) return `≤${fmtShortPrice(maxCents)}`
  return null
}

/** Human one-line summary of a saved search. */
export function describeSavedSearch(a: SavedSearchFields): string {
  const parts: string[] = []

  if (a.listingTypes && a.listingTypes.length > 0) {
    parts.push(a.listingTypes.map((t) => TYPE_LABELS[t] ?? t).join(", "))
  }
  if (a.states && a.states.length > 0) {
    parts.push(a.states.length <= 2 ? a.states.join(", ") : `${a.states.length} states`)
  }
  const price = priceLabel(a.minPrice ?? null, a.maxPrice ?? null)
  if (price) parts.push(price)
  if (a.minYearsOpen && a.minYearsOpen > 0) parts.push(`${a.minYearsOpen}+ yrs open`)
  if (a.centerLat != null && a.centerLng != null && a.radiusMiles != null) {
    parts.push(`within ${a.radiusMiles} mi of ${a.centerLabel || "selected location"}`)
  }
  if (a.query && a.query.trim()) parts.push(`“${a.query.trim()}”`)

  return parts.length > 0 ? parts.join(" · ") : "All listings"
}

/** Build a `/browse` query string (no leading `?`) from a saved search. */
export function savedSearchToBrowseParams(a: SavedSearchFields): string {
  const p = new URLSearchParams()
  if (a.query && a.query.trim()) p.set("query", a.query.trim())
  if (a.listingTypes && a.listingTypes.length > 0) p.set("types", a.listingTypes.join(","))
  if (a.states && a.states.length > 0) p.set("states", a.states.join(","))
  if (a.minPrice != null) p.set("minPrice", String(a.minPrice))
  if (a.maxPrice != null) p.set("maxPrice", String(a.maxPrice))
  if (a.minYearsOpen != null) p.set("minYearsOpen", String(a.minYearsOpen))
  if (a.sort) p.set("sort", a.sort)
  if (a.centerLat != null) p.set("centerLat", String(a.centerLat))
  if (a.centerLng != null) p.set("centerLng", String(a.centerLng))
  if (a.radiusMiles != null) p.set("radiusMiles", String(a.radiusMiles))
  if (a.centerLabel) p.set("centerLabel", a.centerLabel)
  return p.toString()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/__tests__/saved-search.test.ts`
Expected: PASS (3 + 2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/saved-search.ts src/__tests__/saved-search.test.ts
git commit -m "feat(alerts): saved-search label and re-apply helpers"
```

---

### Task 3: Persist all filters in create/update actions

**Files:**
- Modify: `src/lib/alert-actions.ts:26-75` (schema + `createAlert` + `updateAlert`)
- Test: `src/__tests__/alert-actions.test.ts`

**Interfaces:**
- Produces:
  - `alertSchema` (zod) accepting: `name?`, `query?`, `states?: string[]`, `listingTypes?: string[]`, `minPrice?`, `maxPrice?`, `minYearsOpen?`, `sort?`, `centerLat?`, `centerLng?`, `radiusMiles?`, `centerLabel?`, `notifyEnabled?` — all optional.
  - `createAlert(data) → { success, alert } | { error }`
  - `updateAlert(id, data) → { success } | { error }`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/alert-actions.test.ts` inside `describe("createAlert", …)`:

```ts
  it("persists the full filter set", async () => {
    mockSession()
    const fakeAlert = { id: MOCK_ALERT_ID, userId: MOCK_USER_ID }
    const valuesSpy = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([fakeAlert]) })
    mockInsert.mockReturnValue({ values: valuesSpy })

    await createAlert({
      states: ["UT"], listingTypes: ["suite"], minPrice: 50000000, maxPrice: 100000000,
      minYearsOpen: 2, query: "salon", sort: "distance",
      centerLat: 40.2, centerLng: -111.6, radiusMiles: 25, centerLabel: "Provo, UT",
    })

    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: MOCK_USER_ID,
        states: ["UT"], listingTypes: ["suite"], minPrice: 50000000, maxPrice: 100000000,
        minYearsOpen: 2, query: "salon", sort: "distance",
        centerLat: 40.2, centerLng: -111.6, radiusMiles: 25, centerLabel: "Provo, UT",
      }),
    )
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/alert-actions.test.ts -t "persists the full filter set"`
Expected: FAIL — `values` called with only `states`/`userId`.

- [ ] **Step 3: Widen the schema and write all fields**

In `src/lib/alert-actions.ts`, replace the `alertSchema` and the bodies of `createAlert` / `updateAlert`:

```ts
const alertSchema = z.object({
  name: z.string().max(120).optional().nullable(),
  query: z.string().max(200).optional().nullable(),
  states: z.array(z.string()).optional(),
  listingTypes: z.array(z.string()).optional(),
  minPrice: z.number().int().nonnegative().optional().nullable(),
  maxPrice: z.number().int().nonnegative().optional().nullable(),
  minYearsOpen: z.number().int().nonnegative().optional().nullable(),
  sort: z.string().max(40).optional().nullable(),
  centerLat: z.number().min(-90).max(90).optional().nullable(),
  centerLng: z.number().min(-180).max(180).optional().nullable(),
  radiusMiles: z.number().int().positive().max(500).optional().nullable(),
  centerLabel: z.string().max(200).optional().nullable(),
  notifyEnabled: z.boolean().optional(),
})

type AlertInput = z.infer<typeof alertSchema>

function toRow(data: AlertInput) {
  return {
    name: data.name ?? null,
    query: data.query ?? null,
    states: data.states ?? [],
    listingTypes: data.listingTypes ?? [],
    minPrice: data.minPrice ?? null,
    maxPrice: data.maxPrice ?? null,
    minYearsOpen: data.minYearsOpen ?? null,
    sort: data.sort ?? null,
    centerLat: data.centerLat ?? null,
    centerLng: data.centerLng ?? null,
    radiusMiles: data.radiusMiles ?? null,
    centerLabel: data.centerLabel ?? null,
    notifyEnabled: data.notifyEnabled ?? true,
  }
}

export async function createAlert(data: AlertInput) {
  const session = await auth()
  if (!session?.user) return { error: "Not authenticated" }

  const parsed = alertSchema.safeParse(data)
  if (!parsed.success) return { error: "Invalid data" }

  const [alert] = await db
    .insert(alerts)
    .values({ userId: session.user.id!, ...toRow(parsed.data) })
    .returning()

  revalidatePath("/account/alerts")
  return { success: true, alert }
}

export async function updateAlert(id: string, data: AlertInput) {
  const session = await auth()
  if (!session?.user) return { error: "Not authenticated" }

  const existing = await db.query.alerts.findFirst({ where: eq(alerts.id, id) })
  if (!existing || existing.userId !== session.user.id) return { error: "Alert not found" }

  const parsed = alertSchema.safeParse(data)
  if (!parsed.success) return { error: "Invalid data" }

  await db
    .update(alerts)
    .set({ ...toRow(parsed.data), updatedAt: new Date() })
    .where(eq(alerts.id, id))

  revalidatePath("/account/alerts")
  return { success: true }
}
```

- [ ] **Step 4: Run the create/update tests**

Run: `npx vitest run src/__tests__/alert-actions.test.ts`
Expected: PASS (existing create/update/delete/getMyAlerts tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add src/lib/alert-actions.ts src/__tests__/alert-actions.test.ts
git commit -m "feat(alerts): persist full filter set in create/update"
```

---

### Task 4: Expand `triggerAlertMatching` (type, price, years, radius, notify)

**Files:**
- Modify: `src/lib/alert-actions.ts` (`triggerAlertMatching`)
- Test: `src/__tests__/alert-actions.test.ts`

**Interfaces:**
- Consumes: `isWithinRadius` from `@/lib/geo`.
- Produces:
  - `triggerAlertMatching(listing: MatchListing) → { matched: number }`
  - `type MatchListing = { id: string; type: string; city: string | null; state: string | null; askingPrice: number | null; locationName: string | null; locations?: MatchLocation[] }`
  - `type MatchLocation = { state: string | null; latitude: number | null; longitude: number | null; territoryLat: number | null; territoryLng: number | null; openingDate: Date | null }`

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/alert-actions.test.ts` inside `describe("triggerAlertMatching", …)`:

```ts
  function mockAlertsJoin(rows: unknown[]) {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ innerJoin: vi.fn().mockResolvedValue(rows) }),
    })
  }

  it("respects type, price, and notifyEnabled (AND of set criteria)", async () => {
    mockAlertsJoin([
      { alert: { id: "a1", userId: "u1", states: ["TX"], listingTypes: ["suite"], minPrice: null, maxPrice: 60000000, minYearsOpen: null, centerLat: null, centerLng: null, radiusMiles: null, notifyEnabled: true }, user: { id: "u1", email: MOCK_USER_EMAIL, name: MOCK_USER_NAME } },
      { alert: { id: "a2", userId: "u2", states: ["TX"], listingTypes: ["flagship"], minPrice: null, maxPrice: null, minYearsOpen: null, centerLat: null, centerLng: null, radiusMiles: null, notifyEnabled: true }, user: { id: "u2", email: "b@example.com", name: "B" } },
      { alert: { id: "a3", userId: "u3", states: ["TX"], listingTypes: ["suite"], minPrice: null, maxPrice: 60000000, minYearsOpen: null, centerLat: null, centerLng: null, radiusMiles: null, notifyEnabled: false }, user: { id: "u3", email: "c@example.com", name: "C" } },
    ])

    const result = await triggerAlertMatching({
      id: "L", type: "suite", city: "Austin", state: "TX", askingPrice: 50000000, locationName: "X", locations: [],
    })

    // a1 matches (suite + ≤$600k). a2 fails type. a3 disabled.
    expect(result.matched).toBe(1)
    expect(mockSendAlertMatchEmail).toHaveBeenCalledTimes(1)
  })

  it("matches on radius when a center is set", async () => {
    mockAlertsJoin([
      { alert: { id: "a1", userId: "u1", states: [], listingTypes: [], minPrice: null, maxPrice: null, minYearsOpen: null, centerLat: 40.234, centerLng: -111.658, radiusMiles: 25, notifyEnabled: true }, user: { id: "u1", email: MOCK_USER_EMAIL, name: MOCK_USER_NAME } },
    ])

    // Listing location ~22mi away (Heber City) → within 25mi
    const result = await triggerAlertMatching({
      id: "L", type: "bundle", city: "Heber City", state: "UT", askingPrice: 1000, locationName: "X",
      locations: [{ state: "UT", latitude: 40.499, longitude: -111.413, territoryLat: null, territoryLng: null, openingDate: null }],
    })

    expect(result.matched).toBe(1)
  })

  it("excludes a listing outside the radius", async () => {
    mockAlertsJoin([
      { alert: { id: "a1", userId: "u1", states: [], listingTypes: [], minPrice: null, maxPrice: null, minYearsOpen: null, centerLat: 40.234, centerLng: -111.658, radiusMiles: 5, notifyEnabled: true }, user: { id: "u1", email: MOCK_USER_EMAIL, name: MOCK_USER_NAME } },
    ])

    const result = await triggerAlertMatching({
      id: "L", type: "bundle", city: "Salt Lake City", state: "UT", askingPrice: 1000, locationName: "X",
      locations: [{ state: "UT", latitude: 40.76, longitude: -111.89, territoryLat: null, territoryLng: null, openingDate: null }],
    })

    expect(result.matched).toBe(0)
    expect(mockSendAlertMatchEmail).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/__tests__/alert-actions.test.ts -t "triggerAlertMatching"`
Expected: FAIL (type/price/radius/notify not yet honored).

- [ ] **Step 3: Implement expanded matching**

In `src/lib/alert-actions.ts`, add the import and replace `triggerAlertMatching`:

```ts
import { isWithinRadius } from "@/lib/geo"

type MatchLocation = {
  state: string | null
  latitude: number | null
  longitude: number | null
  territoryLat: number | null
  territoryLng: number | null
  openingDate: Date | null
}

type MatchListing = {
  id: string
  type: string
  city: string | null
  state: string | null
  askingPrice: number | null
  locationName: string | null
  locations?: MatchLocation[]
}

export async function triggerAlertMatching(listing: MatchListing) {
  const locations = listing.locations ?? []

  const allAlerts = await db
    .select({ alert: alerts, user: users })
    .from(alerts)
    .innerJoin(users, eq(alerts.userId, users.id))

  const matchingAlerts = allAlerts.filter(({ alert }) => {
    if (alert.notifyEnabled === false) return false

    // State (primary listing state) — empty/null = any
    if (alert.states && alert.states.length > 0) {
      if (!listing.state || !alert.states.includes(listing.state)) return false
    }
    // Type — empty/null = any
    if (alert.listingTypes && alert.listingTypes.length > 0) {
      if (!alert.listingTypes.includes(listing.type)) return false
    }
    // Price (cents)
    if (alert.minPrice != null && (listing.askingPrice == null || listing.askingPrice < alert.minPrice)) return false
    if (alert.maxPrice != null && (listing.askingPrice == null || listing.askingPrice > alert.maxPrice)) return false
    // Min years open — at least one location open long enough
    if (alert.minYearsOpen != null && alert.minYearsOpen > 0) {
      const cutoff = new Date()
      cutoff.setFullYear(cutoff.getFullYear() - alert.minYearsOpen)
      const ok = locations.some((l) => l.openingDate != null && l.openingDate <= cutoff)
      if (!ok) return false
    }
    // Radius — at least one location within radius of the saved center
    if (alert.centerLat != null && alert.centerLng != null && alert.radiusMiles != null) {
      const ok = locations.some((l) => {
        const lat = l.latitude ?? l.territoryLat
        const lng = l.longitude ?? l.territoryLng
        return lat != null && lng != null &&
          isWithinRadius(alert.centerLat!, alert.centerLng!, lat, lng, alert.radiusMiles!)
      })
      if (!ok) return false
    }
    // query and sort are intentionally NOT matched
    return true
  })

  await Promise.all(
    matchingAlerts.map(({ user }) =>
      sendAlertMatchEmail({
        buyerEmail: user.email!,
        buyerName: user.name || "Hello Sugar Buyer",
        listingTitle: listing.locationName || `${listing.city}, ${listing.state}`,
        listingId: listing.id,
        listingType: listing.type,
        city: listing.city || "",
        state: listing.state || "",
        askingPrice: listing.askingPrice || 0,
      }),
    ),
  )

  return { matched: matchingAlerts.length }
}
```

- [ ] **Step 4: Run the matching tests**

Run: `npx vitest run src/__tests__/alert-actions.test.ts`
Expected: PASS — including the two pre-existing state-match tests (they pass `locations` omitted → defaults to `[]`, and only set `states`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/alert-actions.ts src/__tests__/alert-actions.test.ts
git commit -m "feat(alerts): match on type, price, years, and radius"
```

---

### Task 5: Wire listing locations into approval + fix email link

**Files:**
- Modify: `src/lib/admin/actions.ts:101-117` (alert-matching call site)
- Modify: `src/lib/email.ts:190` (and any other `/alerts` link in that file)

**Interfaces:**
- Consumes: `triggerAlertMatching(MatchListing)` from Task 4.

- [ ] **Step 1: Fetch all locations and pass them to the matcher**

In `src/lib/admin/actions.ts`, replace the primary-location fetch + `triggerAlertMatching` call (around lines 101-117) with:

```ts
  // Trigger alert emails for buyers with matching alert criteria
  const locations = await db.query.listingLocations.findMany({
    where: eq(listingLocations.listingId, listingId),
  })
  const primary = locations.find((l) => l.displayOrder === 0) ?? locations[0]

  await triggerAlertMatching({
    id: listing.id,
    type: listing.type,
    city: primary?.city ?? null,
    state: primary?.state ?? null,
    askingPrice: listing.askingPrice,
    locationName: primary?.name ?? listing.title ?? null,
    locations: locations.map((l) => ({
      state: l.state,
      latitude: l.latitude,
      longitude: l.longitude,
      territoryLat: l.territoryLat,
      territoryLng: l.territoryLng,
      openingDate: l.openingDate,
    })),
  })
```

(If `and` is now unused in this file after removing the old `findFirst` predicate, remove it from the drizzle import to keep the lint clean.)

- [ ] **Step 2: Fix the email management link**

In `src/lib/email.ts`, change the alerts link target:

```ts
        <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"}/account/alerts" style="color: #6b7280;">Manage your alerts</a>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/admin/actions.ts src/lib/email.ts
git commit -m "feat(alerts): pass listing locations to matcher; fix manage-alerts link"
```

---

### Task 6: Save the full filter set from `/browse`

**Files:**
- Modify: `src/components/browse/SaveSearchButton.tsx`
- Modify: `src/components/browse/BrowsePage.tsx` (the `<SaveSearchButton … />` usage near line 245)

**Interfaces:**
- Consumes: `createAlert` from `@/lib/alert-actions`; `useListingFilters` raw values from `BrowsePage`.
- Produces: `SaveSearchButton` now takes a `filters: SaveSearchInput` prop (full set), not `states`.

- [ ] **Step 1: Rewrite `SaveSearchButton` to save all filters**

Replace `src/components/browse/SaveSearchButton.tsx`:

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { createAlert } from "@/lib/alert-actions"

export interface SaveSearchInput {
  query?: string | null
  types?: string[]
  states?: string[]
  minPrice?: number | null
  maxPrice?: number | null
  minYearsOpen?: number | null
  sort?: string | null
  centerLat?: number | null
  centerLng?: number | null
  radiusMiles?: number | null
  centerLabel?: string | null
}

export function SaveSearchButton({ filters }: { filters: SaveSearchInput }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSaveSearch() {
    setSaving(true)
    setError(null)
    const result = await createAlert({
      query: filters.query || undefined,
      states: filters.states && filters.states.length > 0 ? filters.states : undefined,
      listingTypes: filters.types && filters.types.length > 0 ? filters.types : undefined,
      minPrice: filters.minPrice ?? undefined,
      maxPrice: filters.maxPrice ?? undefined,
      minYearsOpen: filters.minYearsOpen ?? undefined,
      sort: filters.sort || undefined,
      centerLat: filters.centerLat ?? undefined,
      centerLng: filters.centerLng ?? undefined,
      radiusMiles: filters.radiusMiles ?? undefined,
      centerLabel: filters.centerLabel || undefined,
    })
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSaveSearch}
        disabled={saving || saved}
        className={[
          "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2",
          saved ? "bg-green-100 text-green-800" : "bg-white border border-gray-300 hover:bg-gray-50 text-gray-700",
          saving || saved ? "opacity-75 cursor-not-allowed" : "",
        ].filter(Boolean).join(" ")}
      >
        {saving ? "Saving..." : saved ? "Saved!" : (<><BellIcon /> Save this search</>)}
      </button>
      {saved && (
        <Link href="/account/alerts" className="text-xs font-medium text-hs-red-600 hover:text-hs-red-700">
          View in My Alerts →
        </Link>
      )}
      {error && <p className="text-xs text-hs-red-600">{error}</p>}
    </div>
  )
}

function BellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
```

- [ ] **Step 2: Pass the full filters from `BrowsePage`**

In `src/components/browse/BrowsePage.tsx`, replace `<SaveSearchButton states={filters.states} />` with:

```tsx
            <SaveSearchButton
              filters={{
                query: rawFilters.query || undefined,
                types: rawFilters.types,
                states: rawFilters.states,
                minPrice: rawFilters.minPrice,
                maxPrice: rawFilters.maxPrice,
                minYearsOpen: rawFilters.minYearsOpen,
                sort: rawFilters.sort,
                centerLat: rawFilters.centerLat,
                centerLng: rawFilters.centerLng,
                radiusMiles: rawFilters.radiusMiles,
                centerLabel: rawFilters.centerLabel || undefined,
              }}
            />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Manually verify**

Run the dev server (`npm run dev` if not running). On `/browse`, set a few filters (type, price, a location + radius), click **Save this search**, confirm "Saved!" + the "View in My Alerts" link appears. (Full visual check of the saved row happens in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/SaveSearchButton.tsx src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): save the full filter set as a saved search"
```

---

### Task 7: Shared `AppHeader` (extract from browse header)

**Files:**
- Create: `src/components/layout/AppHeader.tsx`
- Modify: `src/components/browse/BrowsePage.tsx:110-128` (replace inline header with `AppHeader`)

**Interfaces:**
- Consumes: `UserNav` from `@/components/browse/UserNav`.
- Produces: `AppHeader({ title, subtitle?, isAdmin?, hasSeller?, isOwner? })`.

- [ ] **Step 1: Create the shared header**

Create `src/components/layout/AppHeader.tsx`:

```tsx
import { UserNav } from "@/components/browse/UserNav"

interface AppHeaderProps {
  title: string
  subtitle?: string
  isAdmin?: boolean
  hasSeller?: boolean
  isOwner?: boolean
}

export function AppHeader({ title, subtitle, isAdmin, hasSeller, isOwner }: AppHeaderProps) {
  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-hs-red-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">HS</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900 tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
        </div>
        <UserNav isAdmin={isAdmin} hasSeller={hasSeller} isOwner={isOwner} />
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Use it in `BrowsePage`**

In `src/components/browse/BrowsePage.tsx`, add `import { AppHeader } from "@/components/layout/AppHeader"` and replace the existing `<header>…</header>` block (lines ~110-128) with:

```tsx
      <AppHeader
        title="Browse Listings"
        subtitle={`${initialListings.length} active listing${initialListings.length !== 1 ? "s" : ""}`}
        isAdmin={isAdmin}
        hasSeller={hasSeller}
        isOwner={isOwner}
      />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Manually verify**

`/browse` still renders its header (logo, "Browse Listings", count, user nav) unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppHeader.tsx src/components/browse/BrowsePage.tsx
git commit -m "refactor(layout): extract shared AppHeader from browse"
```

---

### Task 8: `SavedSearchCard` component

**Files:**
- Create: `src/components/alerts/SavedSearchCard.tsx`

**Interfaces:**
- Consumes: `Alert` from `@/db/schema/alerts`; `describeSavedSearch`, `savedSearchToBrowseParams` from `@/lib/saved-search`.
- Produces: `SavedSearchCard({ alert, onRename, onDelete, onToggleNotify })` where `onRename(id, name)`, `onDelete(id)`, `onToggleNotify(id, enabled)` are async callbacks.

- [ ] **Step 1: Create the card**

Create `src/components/alerts/SavedSearchCard.tsx`:

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import type { Alert } from "@/db/schema/alerts"
import { describeSavedSearch, savedSearchToBrowseParams } from "@/lib/saved-search"

interface SavedSearchCardProps {
  alert: Alert
  onRename: (id: string, name: string | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onToggleNotify: (id: string, enabled: boolean) => Promise<void>
}

export function SavedSearchCard({ alert, onRename, onDelete, onToggleNotify }: SavedSearchCardProps) {
  const summary = describeSavedSearch(alert)
  const title = alert.name?.trim() || summary
  const browseHref = `/browse?${savedSearchToBrowseParams(alert)}`

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(alert.name ?? "")
  const [busy, setBusy] = useState(false)

  async function saveName() {
    setBusy(true)
    await onRename(alert.id, draftName.trim() || null)
    setBusy(false)
    setRenaming(false)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName() }}
                placeholder={summary}
                className="h-9 rounded-lg border border-gray-300 px-3 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-hs-red-500/20 focus:border-hs-red-500"
              />
              <button onClick={saveName} disabled={busy} className="text-sm font-semibold text-hs-red-600 hover:text-hs-red-700">Save</button>
              <button onClick={() => { setRenaming(false); setDraftName(alert.name ?? "") }} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          ) : (
            <>
              <h3 className="text-base font-semibold text-gray-900 truncate">{title}</h3>
              {alert.name?.trim() && <p className="text-xs text-gray-500 truncate mt-0.5">{summary}</p>}
            </>
          )}
        </div>

        {/* Notifications toggle */}
        <label className="flex items-center gap-2 text-xs text-gray-600 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={alert.notifyEnabled}
            onChange={(e) => onToggleNotify(alert.id, e.target.checked)}
            className="w-4 h-4 accent-hs-red-600"
          />
          Notify
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Link
          href={browseHref}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700"
        >
          Apply search →
        </Link>
        {!renaming && (
          <button onClick={() => setRenaming(true)} className="text-sm font-medium text-gray-600 hover:text-gray-900">Rename</button>
        )}
        <button onClick={() => onDelete(alert.id)} className="text-sm font-medium text-hs-red-600 hover:text-hs-red-700 ml-auto">Delete</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/alerts/SavedSearchCard.tsx
git commit -m "feat(alerts): SavedSearchCard with apply/rename/delete/notify"
```

---

### Task 9: Rebuild the alerts page (browse-styled, cards, navigation)

**Files:**
- Modify: `src/app/account/alerts/page.tsx`
- Modify: `src/app/account/alerts/AlertsManager.tsx`
- Delete: `src/components/alerts/AlertForm.tsx`, `src/components/alerts/AlertList.tsx`

**Interfaces:**
- Consumes: `AppHeader` (Task 7), `SavedSearchCard` (Task 8), `getMyAlerts`/`updateAlert`/`deleteAlert` from `@/lib/alert-actions`.

- [ ] **Step 1: Rebuild the page with the shared header + session flags**

Replace `src/app/account/alerts/page.tsx`:

```tsx
import Link from "next/link"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getMyAlerts } from "@/lib/alert-actions"
import { AppHeader } from "@/components/layout/AppHeader"
import { AlertsManager } from "./AlertsManager"

export default async function AlertsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const isAdmin = session.user.role === "admin"
  const hasSeller = !!session.user.sellerAccess || isAdmin
  const isOwner = !!session.user.ownerIdentifier

  const alerts = await getMyAlerts()

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="My Alerts" subtitle={`${alerts.length} saved search${alerts.length !== 1 ? "es" : ""}`} isAdmin={isAdmin} hasSeller={hasSeller} isOwner={isOwner} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Saved searches</h2>
            <p className="text-sm text-gray-500 mt-1">Apply a saved search to browse it again, or get emailed when a new match is listed.</p>
          </div>
          <Link href="/browse" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
            ← Browse listings
          </Link>
        </div>
        <AlertsManager initialAlerts={alerts} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `AlertsManager` to the card UI**

Replace `src/app/account/alerts/AlertsManager.tsx`:

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import type { Alert } from "@/db/schema/alerts"
import { updateAlert, deleteAlert } from "@/lib/alert-actions"
import { SavedSearchCard } from "@/components/alerts/SavedSearchCard"

export function AlertsManager({ initialAlerts }: { initialAlerts: Alert[] }) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts)
  const [error, setError] = useState<string | null>(null)

  async function handleRename(id: string, name: string | null) {
    setError(null)
    const result = await updateAlert(id, { name })
    if (result.error) setError(result.error)
    else setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)))
  }

  async function handleToggleNotify(id: string, enabled: boolean) {
    setError(null)
    const result = await updateAlert(id, { notifyEnabled: enabled })
    if (result.error) setError(result.error)
    else setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, notifyEnabled: enabled } : a)))
  }

  async function handleDelete(id: string) {
    setError(null)
    const result = await deleteAlert(id)
    if (result.error) setError(result.error)
    else setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <p className="text-gray-600 font-medium">No saved searches yet</p>
        <p className="text-sm text-gray-500 mt-1 mb-4">Set filters on the browse page, then tap “Save this search”.</p>
        <Link href="/browse" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700">
          Go to Browse →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-hs-red-50 border border-hs-red-200 text-hs-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {alerts.map((alert) => (
        <SavedSearchCard
          key={alert.id}
          alert={alert}
          onRename={handleRename}
          onDelete={handleDelete}
          onToggleNotify={handleToggleNotify}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Update the `updateAlert` partial-update behavior**

The card sends partial updates (`{ name }` or `{ notifyEnabled }`) — but `toRow` (Task 3) rewrites ALL columns, which would wipe the filters on a rename. Fix `updateAlert` to merge onto the existing row. In `src/lib/alert-actions.ts`, change `updateAlert` to spread the existing row first:

```ts
export async function updateAlert(id: string, data: AlertInput) {
  const session = await auth()
  if (!session?.user) return { error: "Not authenticated" }

  const existing = await db.query.alerts.findFirst({ where: eq(alerts.id, id) })
  if (!existing || existing.userId !== session.user.id) return { error: "Alert not found" }

  const parsed = alertSchema.safeParse(data)
  if (!parsed.success) return { error: "Invalid data" }

  // Only overwrite keys present in the input; leave the rest of the saved search intact.
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  const d = parsed.data
  if ("name" in d) patch.name = d.name ?? null
  if ("query" in d) patch.query = d.query ?? null
  if ("states" in d) patch.states = d.states ?? []
  if ("listingTypes" in d) patch.listingTypes = d.listingTypes ?? []
  if ("minPrice" in d) patch.minPrice = d.minPrice ?? null
  if ("maxPrice" in d) patch.maxPrice = d.maxPrice ?? null
  if ("minYearsOpen" in d) patch.minYearsOpen = d.minYearsOpen ?? null
  if ("sort" in d) patch.sort = d.sort ?? null
  if ("centerLat" in d) patch.centerLat = d.centerLat ?? null
  if ("centerLng" in d) patch.centerLng = d.centerLng ?? null
  if ("radiusMiles" in d) patch.radiusMiles = d.radiusMiles ?? null
  if ("centerLabel" in d) patch.centerLabel = d.centerLabel ?? null
  if ("notifyEnabled" in d) patch.notifyEnabled = d.notifyEnabled

  await db.update(alerts).set(patch).where(eq(alerts.id, id))
  revalidatePath("/account/alerts")
  return { success: true }
}
```

Note: `zod` strips unknown keys, and optional keys that were omitted are absent from `parsed.data`, so `"name" in d` correctly distinguishes "set to null" from "not provided".

- [ ] **Step 4: Delete the obsolete states-only components**

```bash
git rm src/components/alerts/AlertForm.tsx src/components/alerts/AlertList.tsx
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (no remaining imports of the deleted files).

- [ ] **Step 6: Run the full alert test suite**

Run: `npx vitest run src/__tests__/alert-actions.test.ts src/__tests__/saved-search.test.ts`
Expected: PASS.

- [ ] **Step 7: Manually verify end-to-end**

`npm run dev`. On `/browse`: set type + price + location/radius → **Save this search** → **View in My Alerts**. On `/account/alerts`: confirm browse-style header, the saved-search card with the correct summary, **Apply search** returns to `/browse` with filters applied, **Rename** persists, the **Notify** toggle persists, **Delete** removes it, and **← Browse listings** + the header nav move between pages.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(alerts): browse-styled alerts page with saved-search cards"
```

---

## Self-Review

**Spec coverage:**
- Save all filters incl. location/radius → Tasks 1, 3, 6. ✓
- Re-applyable (Apply → /browse) → Tasks 2 (`savedSearchToBrowseParams`), 8, 9. ✓
- Email matching on expanded criteria incl. radius → Tasks 4, 5. ✓
- `query`/`sort` saved but not matched → Task 4 (explicit), Task 2 (serialized). ✓
- Per-search notify toggle → Tasks 1, 4, 8, 9. ✓
- Auto-label + rename → Tasks 2, 8, 9. ✓
- Browse-styled alerts page → Tasks 7, 8, 9. ✓
- Bidirectional navigation → Tasks 7 (shared header/UserNav), 9 (Browse link). ✓
- Email link fix → Task 5. ✓
- Out of scope honored: no in-place filter editor (rename/notify/delete only), no query matching, no per-card map, mobile drawer untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `createAlert`/`updateAlert` take `AlertInput`; `SaveSearchInput` (Task 6) maps to it; `MatchListing`/`MatchLocation` (Task 4) consumed by Task 5; `describeSavedSearch`/`savedSearchToBrowseParams` take `SavedSearchFields` and are fed `Alert` rows (a superset) in Tasks 8/9; `AppHeader` props match both call sites. ✓

**Note on ordering:** Task 9 Step 3 corrects `updateAlert` to a merge-patch so partial updates (rename / notify) don't wipe saved filters — this supersedes the full-overwrite `updateAlert` body shown in Task 3. The Task 3 create path (`toRow`) is unchanged.
