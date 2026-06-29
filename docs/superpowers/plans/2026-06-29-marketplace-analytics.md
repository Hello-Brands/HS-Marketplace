# Marketplace Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only Analytics tab (per-user logins + activity, summary cards, 30-day login trend chart, sortable user table with sparkline) and a public per-listing stat strip (days listed · views · saves).

**Architecture:** Three pieces of new tracking — a `listing_views` table (unique viewer per day), a `login_events` table (one row per login), and a set-once `listings.listedAt` timestamp — feed two read surfaces: a presentational stat strip on `/listings/[id]` and a new `/admin/analytics` dashboard. Saves, reach-outs, inquiries-received, and listings-posted are derived from existing tables (`favorites`, `contacts`, `listings`). Pure logic lives in `src/lib/analytics/helpers.ts` and is unit-tested; DB write paths are tested with the project's `vi.mock` pattern; SQL aggregations and UI are gated with `tsc`.

**Tech Stack:** Next.js 15 (App Router, custom build — see Global Constraints), Drizzle ORM on Neon Postgres (push-managed), NextAuth v5 beta, recharts (already installed), Tailwind with the Hello Sugar palette, Vitest.

## Global Constraints

- **This is NOT stock Next.js.** Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices (per `AGENTS.md`).
- **DB is push-managed**, not migration-file managed. Apply schema changes with `npm run db:push` (drizzle-kit push) — do **not** write migration files or run `db:migrate`.
- **Windows build lock:** stop the dev server before `npm run build` (`.next` lock on this machine). Use `npx tsc --noEmit` as the per-step compile gate. `npm run lint` is broken pre-existing — do not rely on it.
- **Viewers are always authenticated** — the marketplace is fully behind Google sign-in + allowlist. Viewer identity is `users.id`; no anonymous-cookie handling.
- **Brand color:** primary red is `--hs-red-600` = `#dc2626`; use existing `hs-red-*` / `text-hs-red-600` Tailwind classes.
- **New schema files** go in `src/db/schema/` and must be re-exported from `src/db/schema.ts`.
- **ID convention:** text primary keys with `.$defaultFn(() => crypto.randomUUID())`, matching existing tables.
- **All admin server actions** start with the `requireAdmin()` guard pattern from `src/app/admin/users/actions.ts`.

---

### Task 1: Schema — new tables, columns, push, and backfill

**Files:**
- Create: `src/db/schema/listingViews.ts`
- Create: `src/db/schema/loginEvents.ts`
- Modify: `src/db/schema/listings.ts:42-50` (add `listedAt`)
- Modify: `src/db/schema/auth.ts:5-22` (add `loginCount`, `lastLoginAt`)
- Modify: `src/db/schema.ts` (re-export the two new schema files)
- Create: `scripts/backfill-listed-at.ts`

**Interfaces:**
- Produces: tables `listingViews` (`{ id, listingId, viewerId, viewDate, createdAt }`, unique on `(listingId, viewerId, viewDate)`), `loginEvents` (`{ id, userId, createdAt }`); columns `listings.listedAt: timestamp | null`, `users.loginCount: number`, `users.lastLoginAt: Date | null`.

- [ ] **Step 1: Create `src/db/schema/listingViews.ts`**

```ts
import { pgTable, text, timestamp, date, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { listings } from "./listings"
import { users } from "./auth"

// One row per (listing, viewer, calendar day) — powers the "unique per day"
// public view metric. viewDate is date-only (string mode, UTC "YYYY-MM-DD")
// so refreshes within a day collapse to a single row.
export const listingViews = pgTable(
  "listing_views",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
    viewerId: text("viewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    viewDate: date("view_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("listing_views_listing_viewer_date_idx").on(
      table.listingId, table.viewerId, table.viewDate,
    ),
  ],
)

export const listingViewsRelations = relations(listingViews, ({ one }) => ({
  listing: one(listings, { fields: [listingViews.listingId], references: [listings.id] }),
  viewer: one(users, { fields: [listingViews.viewerId], references: [users.id] }),
}))

export type ListingView = typeof listingViews.$inferSelect
export type NewListingView = typeof listingViews.$inferInsert
```

- [ ] **Step 2: Create `src/db/schema/loginEvents.ts`**

```ts
import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

// One row per successful login. Source of truth for the 30-day login trend
// chart and "active this week". users.loginCount / lastLoginAt are denormalized
// conveniences written alongside.
export const loginEvents = pgTable(
  "login_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("login_events_created_at_idx").on(table.createdAt),
    index("login_events_user_id_idx").on(table.userId),
  ],
)

export const loginEventsRelations = relations(loginEvents, ({ one }) => ({
  user: one(users, { fields: [loginEvents.userId], references: [users.id] }),
}))

export type LoginEvent = typeof loginEvents.$inferSelect
export type NewLoginEvent = typeof loginEvents.$inferInsert
```

- [ ] **Step 3: Add `listedAt` to `src/db/schema/listings.ts`**

In the `listings` table definition, in the `// Timestamps` block (currently lines 47-49), add `listedAt` immediately after `createdAt`:

```ts
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Set once, the first time status becomes 'active'. Powers "days listed".
  listedAt: timestamp("listed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
```

- [ ] **Step 4: Add login columns to `src/db/schema/auth.ts`**

In the `users` table, after the `createdAt` column (line 14), add:

```ts
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Login analytics (denormalized; login_events is source of truth)
  loginCount: integer("login_count").default(0).notNull(),
  lastLoginAt: timestamp("last_login_at"),
```

(`integer` and `timestamp` are already imported at the top of this file.)

- [ ] **Step 5: Re-export new schema files in `src/db/schema.ts`**

After the `export * from "./schema/favorites"` line, add:

```ts
export * from "./schema/listingViews"
export * from "./schema/loginEvents"
```

- [ ] **Step 6: Compile-check**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 7: Push schema to Neon**

Run: `npm run db:push`
Expected: drizzle-kit reports the new tables `listing_views`, `login_events`, and the new columns `listings.listed_at`, `users.login_count`, `users.last_login_at` created. Accept the changes when prompted.

- [ ] **Step 8: Create backfill script `scripts/backfill-listed-at.ts`**

```ts
// One-time backfill: set listings.listedAt = createdAt for every listing that
// has ever been live (active/sold/delisted) and has no listedAt yet.
// Run once after db:push:  npx tsx scripts/backfill-listed-at.ts
import { db } from "@/db"
import { listings } from "@/db/schema/listings"
import { isNull, inArray, sql } from "drizzle-orm"

async function main() {
  const result = await db
    .update(listings)
    .set({ listedAt: sql`${listings.createdAt}` })
    .where(
      sql`${listings.listedAt} is null and ${listings.status} in ('active','sold','delisted')`,
    )
    .returning({ id: listings.id })
  console.log(`Backfilled listedAt for ${result.length} listing(s).`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 9: Run the backfill**

Run: `npx tsx scripts/backfill-listed-at.ts`
Expected: prints `Backfilled listedAt for N listing(s).` (N ≥ 0, no error).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/listingViews.ts src/db/schema/loginEvents.ts src/db/schema/listings.ts src/db/schema/auth.ts src/db/schema.ts scripts/backfill-listed-at.ts
git commit -m "feat(analytics): schema for views, logins, and listedAt + backfill"
```

---

### Task 2: Pure analytics helpers

**Files:**
- Create: `src/lib/analytics/helpers.ts`
- Test: `src/__tests__/analytics/helpers.test.ts`

**Interfaces:**
- Produces:
  - `daysListed(start: Date, now: Date): number` — whole calendar days (UTC), min 0.
  - `shouldRecordView(p: { viewerId: string; sellerId: string; viewerRole: string }): boolean` — false for the listing's own seller or any admin.
  - `nextListedAt(current: Date | null, targetStatus: string, now: Date): Date | null` — set-once: returns `current ?? now` when activating, else `current`.

- [ ] **Step 1: Write the failing test `src/__tests__/analytics/helpers.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { daysListed, shouldRecordView, nextListedAt } from "@/lib/analytics/helpers"

describe("daysListed", () => {
  it("is 0 for the same UTC day", () => {
    expect(daysListed(new Date("2026-06-29T01:00:00Z"), new Date("2026-06-29T23:00:00Z"))).toBe(0)
  })
  it("counts whole days across a boundary", () => {
    expect(daysListed(new Date("2026-06-17T12:00:00Z"), new Date("2026-06-29T00:00:00Z"))).toBe(12)
  })
  it("never returns negative", () => {
    expect(daysListed(new Date("2026-06-29T00:00:00Z"), new Date("2026-06-17T00:00:00Z"))).toBe(0)
  })
})

describe("shouldRecordView", () => {
  it("counts an ordinary viewer", () => {
    expect(shouldRecordView({ viewerId: "u1", sellerId: "s1", viewerRole: "user" })).toBe(true)
  })
  it("skips the listing's own seller", () => {
    expect(shouldRecordView({ viewerId: "s1", sellerId: "s1", viewerRole: "user" })).toBe(false)
  })
  it("skips admins", () => {
    expect(shouldRecordView({ viewerId: "u2", sellerId: "s1", viewerRole: "admin" })).toBe(false)
  })
})

describe("nextListedAt", () => {
  const now = new Date("2026-06-29T00:00:00Z")
  it("sets the timestamp when first activating", () => {
    expect(nextListedAt(null, "active", now)).toEqual(now)
  })
  it("does not overwrite an existing timestamp on re-activation", () => {
    const earlier = new Date("2026-01-01T00:00:00Z")
    expect(nextListedAt(earlier, "active", now)).toEqual(earlier)
  })
  it("leaves it untouched for non-active transitions", () => {
    expect(nextListedAt(null, "delisted", now)).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- helpers`
Expected: FAIL — cannot resolve `@/lib/analytics/helpers`.

- [ ] **Step 3: Implement `src/lib/analytics/helpers.ts`**

```ts
const MS_PER_DAY = 86_400_000

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Whole calendar days (UTC) between start and now; never negative. */
export function daysListed(start: Date, now: Date): number {
  return Math.max(0, Math.floor((utcMidnight(now) - utcMidnight(start)) / MS_PER_DAY))
}

/** A view counts unless it's the listing's own seller or any admin. */
export function shouldRecordView(p: {
  viewerId: string
  sellerId: string
  viewerRole: string
}): boolean {
  if (p.viewerId === p.sellerId) return false
  if (p.viewerRole === "admin") return false
  return true
}

/** Set-once listedAt: stamp 'now' only the first time we go active. */
export function nextListedAt(current: Date | null, targetStatus: string, now: Date): Date | null {
  if (targetStatus === "active") return current ?? now
  return current
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- helpers`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/helpers.ts src/__tests__/analytics/helpers.test.ts
git commit -m "feat(analytics): pure helpers for days-listed, view gating, listedAt"
```

---

### Task 3: Wire set-once `listedAt` into both status-transition paths

**Files:**
- Modify: `src/lib/listings/actions.ts:176-182` (`changeListingStatus`)
- Modify: `src/lib/admin/actions.ts:82-88` (admin approve)
- Test: `src/__tests__/analytics/listed-at-wiring.test.ts`

**Interfaces:**
- Consumes: `nextListedAt` from `src/lib/analytics/helpers.ts` (Task 2).

- [ ] **Step 1: Write the failing test `src/__tests__/analytics/listed-at-wiring.test.ts`**

This test mocks `@/db` and `@/auth` (project pattern from `src/__tests__/contact-actions.test.ts`) and asserts `changeListingStatus` writes a non-null `listedAt` when activating a listing that has none.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAuth, mockSelect, mockUpdate, setWhere } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  setWhere: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    update: mockUpdate,
  },
}))

import { changeListingStatus } from "@/lib/listings/actions"

describe("changeListingStatus listedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin", sellerAccess: true } })
    // db.update(...).set(...).where(...)
    const setFn = vi.fn(() => ({ where: setWhere }))
    mockUpdate.mockReturnValue({ set: setFn })
    ;(mockUpdate as unknown as { lastSet?: typeof setFn }).lastSet = setFn
  })

  it("stamps listedAt when activating a listing that has none", async () => {
    mockSelect.mockResolvedValue([
      { id: "L1", sellerId: "seller-9", status: "pending", listedAt: null },
    ])
    await changeListingStatus("L1", "active")
    const setFn = mockUpdate.mock.results[0].value.set
    const payload = setFn.mock.calls[0][0]
    expect(payload.status).toBe("active")
    expect(payload.listedAt).toBeInstanceOf(Date)
  })

  it("does not overwrite an existing listedAt", async () => {
    const original = new Date("2026-01-01T00:00:00Z")
    mockSelect.mockResolvedValue([
      { id: "L1", sellerId: "seller-9", status: "delisted", listedAt: original },
    ])
    await changeListingStatus("L1", "active")
    const setFn = mockUpdate.mock.results[0].value.set
    expect(setFn.mock.calls[0][0].listedAt).toEqual(original)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- listed-at-wiring`
Expected: FAIL — `listedAt` is `undefined` in the update payload (not yet wired).

- [ ] **Step 3: Wire `changeListingStatus` in `src/lib/listings/actions.ts`**

Add the helper import near the top (after the `canTransition` import on line 9):

```ts
import { nextListedAt } from '@/lib/analytics/helpers'
```

Replace the `db.update` block (lines 176-182) with:

```ts
  await db.update(listings)
    .set({
      status: targetStatus,
      listedAt: nextListedAt(listing.listedAt, targetStatus, new Date()),
      rejectionReason: targetStatus === 'rejected' ? reason : null,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId))
```

- [ ] **Step 4: Wire the admin approve path in `src/lib/admin/actions.ts`**

Add near the existing imports at the top of the file:

```ts
import { nextListedAt } from '@/lib/analytics/helpers'
```

Replace the `db.update` block (lines 82-88) with:

```ts
  await db.update(listings)
    .set({
      status: 'active',
      listedAt: nextListedAt(listing.listedAt ?? null, 'active', new Date()),
      rejectionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId))
```

(`listing` here is the row fetched earlier in `approveListing`; it now includes `listedAt`.)

- [ ] **Step 5: Run the test + compile-check**

Run: `npm test -- listed-at-wiring && npx tsc --noEmit`
Expected: tests PASS; tsc PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/listings/actions.ts src/lib/admin/actions.ts src/__tests__/analytics/listed-at-wiring.test.ts
git commit -m "feat(analytics): stamp listedAt once on first activation"
```

---

### Task 4: View recording action + wire into the listing detail page

**Files:**
- Create: `src/lib/analytics/views.ts`
- Modify: `src/app/listings/[id]/page.tsx` (call `recordListingView` after auth/listing load)
- Test: `src/__tests__/analytics/record-view.test.ts`

**Interfaces:**
- Consumes: `shouldRecordView` (Task 2); `listings`, `listingViews` schema (Task 1).
- Produces: `recordListingView(listingId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test `src/__tests__/analytics/record-view.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAuth, mockSelect, mockInsert, mockUpdate, returningFn } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  returningFn: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    insert: mockInsert,
    update: mockUpdate,
  },
}))

import { recordListingView } from "@/lib/analytics/views"

beforeEach(() => {
  vi.clearAllMocks()
  // insert(...).values(...).onConflictDoNothing(...).returning() -> returningFn()
  mockInsert.mockReturnValue({
    values: () => ({ onConflictDoNothing: () => ({ returning: returningFn }) }),
  })
  mockUpdate.mockReturnValue({ set: () => ({ where: vi.fn().mockResolvedValue(undefined) }) })
})

it("does nothing when unauthenticated", async () => {
  mockAuth.mockResolvedValue(null)
  await recordListingView("L1")
  expect(mockInsert).not.toHaveBeenCalled()
})

it("skips the listing's own seller", async () => {
  mockAuth.mockResolvedValue({ user: { id: "seller-1", role: "user" } })
  mockSelect.mockResolvedValue([{ sellerId: "seller-1" }])
  await recordListingView("L1")
  expect(mockInsert).not.toHaveBeenCalled()
})

it("inserts and increments viewCount for a new viewer-day", async () => {
  mockAuth.mockResolvedValue({ user: { id: "viewer-1", role: "user" } })
  mockSelect.mockResolvedValue([{ sellerId: "seller-1" }])
  returningFn.mockResolvedValue([{ id: "view-1" }]) // a row was inserted
  await recordListingView("L1")
  expect(mockInsert).toHaveBeenCalled()
  expect(mockUpdate).toHaveBeenCalled()
})

it("does not increment when the viewer-day already exists", async () => {
  mockAuth.mockResolvedValue({ user: { id: "viewer-1", role: "user" } })
  mockSelect.mockResolvedValue([{ sellerId: "seller-1" }])
  returningFn.mockResolvedValue([]) // conflict — nothing inserted
  await recordListingView("L1")
  expect(mockInsert).toHaveBeenCalled()
  expect(mockUpdate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- record-view`
Expected: FAIL — cannot resolve `@/lib/analytics/views`.

- [ ] **Step 3: Implement `src/lib/analytics/views.ts`**

```ts
'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { listings } from '@/db/schema/listings'
import { listingViews } from '@/db/schema/listingViews'
import { eq, sql } from 'drizzle-orm'
import { shouldRecordView } from './helpers'

/**
 * Record a unique-per-day view of a listing. No-ops for guests, the listing's
 * own seller, and admins. Dedupes on (listing, viewer, UTC day) via the unique
 * index; bumps listings.viewCount only when a new row is actually inserted.
 */
export async function recordListingView(listingId: string): Promise<void> {
  const session = await auth()
  const viewerId = session?.user?.id
  if (!viewerId) return

  const [row] = await db
    .select({ sellerId: listings.sellerId })
    .from(listings)
    .where(eq(listings.id, listingId))
  if (!row) return

  if (!shouldRecordView({ viewerId, sellerId: row.sellerId, viewerRole: session.user.role })) {
    return
  }

  const viewDate = new Date().toISOString().slice(0, 10) // UTC YYYY-MM-DD

  const inserted = await db
    .insert(listingViews)
    .values({ listingId, viewerId, viewDate })
    .onConflictDoNothing({
      target: [listingViews.listingId, listingViews.viewerId, listingViews.viewDate],
    })
    .returning({ id: listingViews.id })

  if (inserted.length > 0) {
    await db
      .update(listings)
      .set({ viewCount: sql`${listings.viewCount} + 1` })
      .where(eq(listings.id, listingId))
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- record-view`
Expected: PASS (all four cases).

- [ ] **Step 5: Wire it into the listing page `src/app/listings/[id]/page.tsx`**

Add the import alongside the other `@/lib` imports near the top:

```ts
import { recordListingView } from '@/lib/analytics/views'
```

In `ListingDetailPage`, immediately after the `if (!listing) { notFound() }` block (around line 46), record the view before the existing `Promise.all`:

```ts
  await recordListingView(listing.id)
```

- [ ] **Step 6: Compile-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analytics/views.ts src/app/listings/[id]/page.tsx src/__tests__/analytics/record-view.test.ts
git commit -m "feat(analytics): record unique-per-day listing views"
```

---

### Task 5: Login tracking

**Files:**
- Create: `src/lib/analytics/logins.ts`
- Modify: `src/auth.ts:56-60` (call `recordLogin` in the `signIn` event)
- Test: `src/__tests__/analytics/record-login.test.ts`

**Interfaces:**
- Consumes: `loginEvents` schema, `users.loginCount/lastLoginAt` (Task 1).
- Produces: `recordLogin(userId: string): Promise<void>`.

- [ ] **Step 1: Write the failing test `src/__tests__/analytics/record-login.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockInsert, mockUpdate, valuesFn, setWhere } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  valuesFn: vi.fn(),
  setWhere: vi.fn(),
}))

vi.mock("@/db", () => ({ db: { insert: mockInsert, update: mockUpdate } }))

import { recordLogin } from "@/lib/analytics/logins"

beforeEach(() => {
  vi.clearAllMocks()
  mockInsert.mockReturnValue({ values: valuesFn.mockResolvedValue(undefined) })
  mockUpdate.mockReturnValue({ set: () => ({ where: setWhere.mockResolvedValue(undefined) }) })
})

it("inserts a login event and bumps the user's counters", async () => {
  await recordLogin("user-7")
  expect(mockInsert).toHaveBeenCalled()
  expect(valuesFn).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-7" }))
  expect(mockUpdate).toHaveBeenCalled()
  expect(setWhere).toHaveBeenCalled()
})

it("no-ops without a userId", async () => {
  await recordLogin("")
  expect(mockInsert).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- record-login`
Expected: FAIL — cannot resolve `@/lib/analytics/logins`.

- [ ] **Step 3: Implement `src/lib/analytics/logins.ts`**

```ts
import { db } from '@/db'
import { loginEvents } from '@/db/schema/loginEvents'
import { users } from '@/db/schema/auth'
import { eq, sql } from 'drizzle-orm'

/**
 * Record a successful login: append a login_events row and bump the
 * denormalized counters on the user. Never throws into the auth flow — callers
 * wrap it so a tracking failure can't block sign-in.
 */
export async function recordLogin(userId: string): Promise<void> {
  if (!userId) return
  await db.insert(loginEvents).values({ userId })
  await db
    .update(users)
    .set({ loginCount: sql`${users.loginCount} + 1`, lastLoginAt: new Date() })
    .where(eq(users.id, userId))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- record-login`
Expected: PASS.

- [ ] **Step 5: Call `recordLogin` from the `signIn` event in `src/auth.ts`**

Add the import near the top (after the `linkOwnerAtLogin` import on line 7):

```ts
import { recordLogin } from "@/lib/analytics/logins"
```

Replace the `events.signIn` handler (lines 56-60) with:

```ts
    async signIn({ user }) {
      if (user.id) {
        await linkOwnerAtLogin(user.id, user.email)
        // Never let a tracking failure block login.
        try {
          await recordLogin(user.id)
        } catch (err) {
          console.error("recordLogin failed", err)
        }
      }
    },
```

- [ ] **Step 6: Run tests + compile-check**

Run: `npm test -- record-login && npx tsc --noEmit`
Expected: tests PASS; tsc PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analytics/logins.ts src/auth.ts src/__tests__/analytics/record-login.test.ts
git commit -m "feat(analytics): record login events and user login counters"
```

---

### Task 6: Public stat strip on the listing page

**Files:**
- Modify: `src/lib/listing-detail.ts` (add `listedAt` + `savesCount` to `ListingDetail` and `getListingById`)
- Create: `src/components/listing-detail/StatStrip.tsx`
- Modify: `src/app/listings/[id]/page.tsx` (render `StatStrip`; remove old view/inquiry pills)

**Interfaces:**
- Consumes: `daysListed` (Task 2); `favorites` schema.
- Produces: `ListingDetail.listedAt: Date | null`, `ListingDetail.savesCount: number`; `<StatStrip listedAt createdAt viewCount savesCount />`.

- [ ] **Step 1: Extend the `ListingDetail` interface in `src/lib/listing-detail.ts`**

In the `ListingDetail` interface, after `createdAt: Date` (line 40), add:

```ts
  createdAt: Date
  listedAt: Date | null
  savesCount: number
```

- [ ] **Step 2: Populate the new fields in `getListingById`**

Add `favorites` + `count` imports at the top of the file:

```ts
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { favorites } from '@/db/schema/favorites'
import { users } from '@/db/schema/auth'
import { eq, count } from 'drizzle-orm'
```

After the `if (!listing || listing.status !== 'active') { return null }` guard, compute the saves count:

```ts
  const [saves] = await db
    .select({ value: count() })
    .from(favorites)
    .where(eq(favorites.listingId, id))
```

Then in the returned object, alongside `createdAt: listing.createdAt`, add:

```ts
    createdAt: listing.createdAt,
    listedAt: listing.listedAt ?? null,
    savesCount: saves?.value ?? 0,
```

- [ ] **Step 3: Create `src/components/listing-detail/StatStrip.tsx`**

```tsx
import { daysListed } from '@/lib/analytics/helpers'

interface StatStripProps {
  listedAt: Date | null
  createdAt: Date
  viewCount: number
  savesCount: number
}

function Cell({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex-1 px-2 py-3.5 text-center border-r border-gray-100 last:border-r-0">
      <div className="flex items-center justify-center gap-1.5 text-2xl font-bold text-gray-900 leading-none">
        <span className="text-hs-red-600">{icon}</span>
        {value}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
    </div>
  )
}

export function StatStrip({ listedAt, createdAt, viewCount, savesCount }: StatStripProps) {
  const days = daysListed(listedAt ?? createdAt, new Date())
  const iconCls = 'h-4 w-4'
  return (
    <div className="mt-5 flex items-stretch rounded-xl border border-gray-200 overflow-hidden">
      <Cell
        icon={
          <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        }
        value={days === 0 ? 'New' : String(days)}
        label="Days listed"
      />
      <Cell
        icon={
          <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
        value={String(viewCount)}
        label="Views"
      />
      <Cell
        icon={
          <svg className={iconCls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 14c1.5-1.5 3-3.3 3-5.5A3.5 3.5 0 0 0 12 6 3.5 3.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z" />
          </svg>
        }
        value={String(savesCount)}
        label="Saves"
      />
    </div>
  )
}
```

- [ ] **Step 4: Render the strip and remove the old pills in `src/app/listings/[id]/page.tsx`**

Add the import:

```ts
import { StatStrip } from '@/components/listing-detail/StatStrip'
```

**Remove** the two `{listing.viewCount > 0 && (...)}` and `{listing.inquiryCount > 0 && (...)}` pill blocks (lines ~96-112) from the badge row — the strip replaces them.

Then place the strip directly below the listing header (after the locations `{listing.locations.length > 0 && (...)}` block that closes around line 132, and before the `{/* Two column layout on desktop */}` grid at line 135):

```tsx
        <StatStrip
          listedAt={listing.listedAt}
          createdAt={listing.createdAt}
          viewCount={listing.viewCount}
          savesCount={listing.savesCount}
        />
```

- [ ] **Step 5: Run tests + compile-check**

Run: `npm test && npx tsc --noEmit`
Expected: existing suite PASS; tsc PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/listing-detail.ts src/components/listing-detail/StatStrip.tsx src/app/listings/[id]/page.tsx
git commit -m "feat(analytics): public stat strip (days listed / views / saves) on listing page"
```

---

### Task 7: Admin analytics data layer

**Files:**
- Create: `src/app/admin/analytics/actions.ts`
- Test: `src/__tests__/analytics/trend-fill.test.ts`

**Interfaces:**
- Consumes: `users`, `listings`, `contacts`, `favorites`, `loginEvents` schema.
- Produces:
  - `getAnalyticsSummary(): Promise<AnalyticsSummary>` — `{ totalUsers, activeThisWeek, logins30d, inquiries30d }`.
  - `getLoginTrend(): Promise<LoginTrendPoint[]>` — 30 zero-filled daily points `{ date: 'YYYY-MM-DD', count }`.
  - `getUserAnalytics(): Promise<UserAnalyticsRow[]>` — one row per user with login + activity counts and a 7-length `spark` array.
  - `fillTrend(rows: { date: string; count: number }[], days: number, today: Date): LoginTrendPoint[]` (exported pure helper, unit-tested).

- [ ] **Step 1: Write the failing test `src/__tests__/analytics/trend-fill.test.ts`**

```ts
import { describe, it, expect } from "vitest"
import { fillTrend } from "@/app/admin/analytics/actions"

describe("fillTrend", () => {
  const today = new Date("2026-06-29T12:00:00Z")
  it("returns one point per day, oldest first, ending today", () => {
    const out = fillTrend([], 30, today)
    expect(out).toHaveLength(30)
    expect(out[29].date).toBe("2026-06-29")
    expect(out[0].date).toBe("2026-05-31")
    expect(out.every((p) => p.count === 0)).toBe(true)
  })
  it("maps known counts onto their dates and zero-fills the rest", () => {
    const out = fillTrend([{ date: "2026-06-29", count: 5 }, { date: "2026-06-27", count: 2 }], 30, today)
    expect(out.find((p) => p.date === "2026-06-29")!.count).toBe(5)
    expect(out.find((p) => p.date === "2026-06-27")!.count).toBe(2)
    expect(out.find((p) => p.date === "2026-06-28")!.count).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- trend-fill`
Expected: FAIL — `fillTrend` not exported.

- [ ] **Step 3: Implement `src/app/admin/analytics/actions.ts`**

```ts
"use server"

import { auth } from "@/auth"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { listings } from "@/db/schema/listings"
import { contacts } from "@/db/schema/contacts"
import { favorites } from "@/db/schema/favorites"
import { loginEvents } from "@/db/schema/loginEvents"
import { and, count, countDistinct, eq, gte, sql } from "drizzle-orm"

export interface AnalyticsSummary {
  totalUsers: number
  activeThisWeek: number
  logins30d: number
  inquiries30d: number
}

export interface LoginTrendPoint {
  date: string
  count: number
}

export interface UserAnalyticsRow {
  id: string
  name: string | null
  email: string | null
  role: string
  loginCount: number
  lastLoginAt: Date | null
  listingsPosted: number
  reachOutsSent: number
  inquiriesReceived: number
  savesMade: number
  spark: number[]
}

async function requireAdmin() {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    throw new Error("Unauthorized: Admin access required")
  }
  return session.user
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

/** Zero-fill a daily series: `days` points, oldest first, last point = today (UTC). */
export function fillTrend(
  rows: { date: string; count: number }[],
  days: number,
  today: Date,
): LoginTrendPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r.count]))
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const out: LoginTrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10)
    out.push({ date, count: byDate.get(date) ?? 0 })
  }
  return out
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  await requireAdmin()
  const [[totalUsers], [activeThisWeek], [logins30d], [inquiries30d]] = await Promise.all([
    db.select({ v: count() }).from(users),
    db.select({ v: countDistinct(loginEvents.userId) }).from(loginEvents)
      .where(gte(loginEvents.createdAt, daysAgo(7))),
    db.select({ v: count() }).from(loginEvents).where(gte(loginEvents.createdAt, daysAgo(30))),
    db.select({ v: count() }).from(contacts).where(gte(contacts.createdAt, daysAgo(30))),
  ])
  return {
    totalUsers: totalUsers?.v ?? 0,
    activeThisWeek: activeThisWeek?.v ?? 0,
    logins30d: logins30d?.v ?? 0,
    inquiries30d: inquiries30d?.v ?? 0,
  }
}

export async function getLoginTrend(): Promise<LoginTrendPoint[]> {
  await requireAdmin()
  const day = sql<string>`to_char(${loginEvents.createdAt}, 'YYYY-MM-DD')`
  const rows = await db
    .select({ date: day, count: count() })
    .from(loginEvents)
    .where(gte(loginEvents.createdAt, daysAgo(30)))
    .groupBy(day)
  return fillTrend(rows, 30, new Date())
}

export async function getUserAnalytics(): Promise<UserAnalyticsRow[]> {
  await requireAdmin()

  const day = sql<string>`to_char(${loginEvents.createdAt}, 'YYYY-MM-DD')`
  const [
    userRows,
    listingRows,
    reachOutRows,
    inquiryRows,
    saveRows,
    sparkRows,
  ] = await Promise.all([
    db.select({
      id: users.id, name: users.name, email: users.email, role: users.role,
      loginCount: users.loginCount, lastLoginAt: users.lastLoginAt,
    }).from(users).orderBy(users.createdAt),
    db.select({ sellerId: listings.sellerId, v: count() }).from(listings).groupBy(listings.sellerId),
    db.select({ buyerId: contacts.buyerId, v: count() }).from(contacts).groupBy(contacts.buyerId),
    db.select({ sellerId: listings.sellerId, v: count() })
      .from(contacts).innerJoin(listings, eq(contacts.listingId, listings.id))
      .groupBy(listings.sellerId),
    db.select({ userId: favorites.userId, v: count() }).from(favorites).groupBy(favorites.userId),
    db.select({ userId: loginEvents.userId, date: day, v: count() })
      .from(loginEvents).where(gte(loginEvents.createdAt, daysAgo(7)))
      .groupBy(loginEvents.userId, day),
  ])

  const listingsBy = new Map(listingRows.map((r) => [r.sellerId, r.v]))
  const reachBy = new Map(reachOutRows.map((r) => [r.buyerId, r.v]))
  const inqBy = new Map(inquiryRows.map((r) => [r.sellerId, r.v]))
  const saveBy = new Map(saveRows.map((r) => [r.userId, r.v]))

  // Build the last-7-days date labels (oldest first) for sparkline alignment.
  const today = new Date()
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const sparkDates: string[] = []
  for (let i = 6; i >= 0; i--) sparkDates.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10))
  const sparkBy = new Map<string, Map<string, number>>()
  for (const r of sparkRows) {
    if (!sparkBy.has(r.userId)) sparkBy.set(r.userId, new Map())
    sparkBy.get(r.userId)!.set(r.date, r.v)
  }

  return userRows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    loginCount: u.loginCount,
    lastLoginAt: u.lastLoginAt,
    listingsPosted: listingsBy.get(u.id) ?? 0,
    reachOutsSent: reachBy.get(u.id) ?? 0,
    inquiriesReceived: inqBy.get(u.id) ?? 0,
    savesMade: saveBy.get(u.id) ?? 0,
    spark: sparkDates.map((d) => sparkBy.get(u.id)?.get(d) ?? 0),
  }))
}
```

- [ ] **Step 4: Run the test + compile-check**

Run: `npm test -- trend-fill && npx tsc --noEmit`
Expected: test PASS; tsc PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/analytics/actions.ts src/__tests__/analytics/trend-fill.test.ts
git commit -m "feat(analytics): admin analytics data layer (summary, trend, per-user)"
```

---

### Task 8: Admin Analytics tab — nav, page, summary cards, sortable table

**Files:**
- Modify: `src/lib/navigation.ts:47-54` (add Analytics nav item)
- Create: `src/app/admin/analytics/page.tsx`
- Create: `src/components/admin/AnalyticsDashboard.tsx` (client: summary cards + sortable/searchable table)

**Interfaces:**
- Consumes: `getAnalyticsSummary`, `getUserAnalytics`, `getLoginTrend`, `UserAnalyticsRow`, `AnalyticsSummary`, `LoginTrendPoint` (Task 7); `LoginTrendChart`, `Sparkline` (Task 9).
- Produces: route `/admin/analytics`; `<AnalyticsDashboard summary users trend />`.

- [ ] **Step 1: Add the nav item in `src/lib/navigation.ts`**

In `ADMIN_NAV` (lines 47-54), add the entry after `Users`:

```ts
  { label: "Users", href: "/admin/users" },
  { label: "Analytics", href: "/admin/analytics" },
  { label: "Data", href: "/admin/data" },
```

- [ ] **Step 2: Create the server page `src/app/admin/analytics/page.tsx`**

```tsx
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getAnalyticsSummary, getUserAnalytics, getLoginTrend } from "./actions"
import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard"

export default async function AdminAnalyticsPage() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    redirect("/")
  }

  const [summary, users, trend] = await Promise.all([
    getAnalyticsSummary(),
    getUserAnalytics(),
    getLoginTrend(),
  ])

  return <AnalyticsDashboard summary={summary} users={users} trend={trend} />
}
```

- [ ] **Step 3: Create the client dashboard `src/components/admin/AnalyticsDashboard.tsx`**

```tsx
"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import type { AnalyticsSummary, UserAnalyticsRow, LoginTrendPoint } from "@/app/admin/analytics/actions"
import { LoginTrendChart } from "./LoginTrendChart"
import { Sparkline } from "./Sparkline"

type SortKey =
  | "loginCount" | "lastLoginAt" | "listingsPosted"
  | "reachOutsSent" | "inquiriesReceived" | "savesMade"

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "loginCount", label: "Logins" },
  { key: "lastLoginAt", label: "Last active" },
  { key: "listingsPosted", label: "Listings" },
  { key: "reachOutsSent", label: "Reach-outs sent" },
  { key: "inquiriesReceived", label: "Inquiries recv’d" },
  { key: "savesMade", label: "Saves" },
]

function timeAgo(d: Date | null): string {
  if (!d) return "—"
  const ms = Date.now() - new Date(d).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d ago`
  const hrs = Math.floor(ms / 3_600_000)
  if (hrs >= 1) return `${hrs}h ago`
  const mins = Math.floor(ms / 60_000)
  return mins <= 1 ? "just now" : `${mins}m ago`
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold text-gray-900 leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-xs font-semibold text-green-600">{hint}</div>}
    </div>
  )
}

export function AnalyticsDashboard({
  summary, users, trend,
}: {
  summary: AnalyticsSummary
  users: UserAnalyticsRow[]
  trend: LoginTrendPoint[]
}) {
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("loginCount")
  const [asc, setAsc] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? users.filter(
          (u) =>
            (u.name ?? "").toLowerCase().includes(q) ||
            (u.email ?? "").toLowerCase().includes(q) ||
            u.role.toLowerCase().includes(q),
        )
      : users
    const sorted = [...filtered].sort((a, b) => {
      const av = sortKey === "lastLoginAt" ? (a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0) : (a[sortKey] as number)
      const bv = sortKey === "lastLoginAt" ? (b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0) : (b[sortKey] as number)
      return asc ? av - bv : bv - av
    })
    return sorted
  }, [users, query, sortKey, asc])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v)
    else { setSortKey(key); setAsc(false) }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
      <p className="mt-1 text-sm text-gray-500">
        Logins and views accrue from launch — early numbers will be low and grow over time.
      </p>

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total users" value={String(summary.totalUsers)} />
        <SummaryCard label="Active this week" value={String(summary.activeThisWeek)} />
        <SummaryCard label="Logins (30d)" value={String(summary.logins30d)} />
        <SummaryCard label="Inquiries (30d)" value={String(summary.inquiries30d)} />
      </div>

      <div className="mt-5 bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-3">Logins — last 30 days</div>
        <LoginTrendChart data={trend} />
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or role…"
          className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-300"
        />
        <span className="text-xs text-gray-400">{rows.length} user{rows.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="mt-3 overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-[10.5px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2.5 font-bold">User</th>
              <th className="px-3 py-2.5 font-bold">Role</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2.5 font-bold text-center whitespace-nowrap">
                  <button onClick={() => toggleSort(c.key)} className={`inline-flex items-center gap-1 ${sortKey === c.key ? "text-hs-red-600" : "hover:text-gray-700"}`}>
                    {c.label}{sortKey === c.key ? (asc ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2.5 font-bold text-center">7-day</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5">
                  <Link href={`/admin/analytics/${u.id}`} className="flex flex-col">
                    <span className="font-semibold text-gray-900">{u.name ?? "—"}</span>
                    <span className="text-xs text-gray-400">{u.email}</span>
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${u.role === "admin" ? "bg-hs-red-100 text-hs-red-800" : "bg-gray-100 text-gray-600"}`}>{u.role}</span>
                </td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.loginCount}</td>
                <td className="px-3 py-2.5 text-center text-gray-500">{timeAgo(u.lastLoginAt)}</td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.listingsPosted || "—"}</td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.reachOutsSent || "—"}</td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.inquiriesReceived || "—"}</td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.savesMade || "—"}</td>
                <td className="px-3 py-2.5"><div className="flex justify-center"><Sparkline data={u.spark} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Compile-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`LoginTrendChart` and `Sparkline` are created in Task 9; if running tasks strictly in order, expect tsc to report those two modules missing until Task 9 — that is acceptable mid-sequence. Otherwise complete Task 9 before this compile gate.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/navigation.ts src/app/admin/analytics/page.tsx src/components/admin/AnalyticsDashboard.tsx
git commit -m "feat(analytics): admin Analytics tab with summary cards and sortable user table"
```

---

### Task 9: Trend chart, sparkline, and per-user detail page

**Files:**
- Create: `src/components/admin/LoginTrendChart.tsx` (recharts)
- Create: `src/components/admin/Sparkline.tsx`
- Create: `src/app/admin/analytics/[userId]/page.tsx`

**Interfaces:**
- Consumes: `LoginTrendPoint`, `UserAnalyticsRow`, `getUserAnalytics` (Task 7).
- Produces: `<LoginTrendChart data={LoginTrendPoint[]} />`, `<Sparkline data={number[]} />`, route `/admin/analytics/[userId]`.

- [ ] **Step 1: Create `src/components/admin/LoginTrendChart.tsx`**

```tsx
"use client"

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import type { LoginTrendPoint } from "@/app/admin/analytics/actions"

export function LoginTrendChart({ data }: { data: LoginTrendPoint[] }) {
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="loginFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dc2626" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            tickFormatter={(d: string) => d.slice(5)}
            interval={4}
            axisLine={false}
            tickLine={false}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={28} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            labelStyle={{ color: "#6b7280" }}
          />
          <Area type="monotone" dataKey="count" name="Logins" stroke="#dc2626" strokeWidth={2} fill="url(#loginFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/admin/Sparkline.tsx`**

```tsx
export function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data)
  return (
    <div className="flex items-end gap-[2px] h-5" aria-hidden="true">
      {data.map((v, i) => (
        <span
          key={i}
          className="w-[5px] rounded-sm bg-hs-red-300"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create the per-user detail page `src/app/admin/analytics/[userId]/page.tsx`**

```tsx
import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { getUserAnalytics } from "../actions"
import { Sparkline } from "@/components/admin/Sparkline"

type Props = { params: Promise<{ userId: string }> }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold text-gray-900 leading-none">{value}</div>
    </div>
  )
}

export default async function UserAnalyticsDetailPage({ params }: Props) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/")

  const { userId } = await params
  const u = (await getUserAnalytics()).find((r) => r.id === userId)
  if (!u) notFound()

  const lastActive = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"

  return (
    <div>
      <Link href="/admin/analytics" className="text-sm text-hs-red-600 hover:underline">← Back to Analytics</Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">{u.name ?? "Unnamed user"}</h1>
      <p className="text-sm text-gray-500">{u.email} · {u.role}</p>

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Logins" value={String(u.loginCount)} />
        <Stat label="Last active" value={lastActive} />
        <Stat label="Listings posted" value={String(u.listingsPosted)} />
        <Stat label="Reach-outs sent" value={String(u.reachOutsSent)} />
        <Stat label="Inquiries received" value={String(u.inquiriesReceived)} />
        <Stat label="Saves made" value={String(u.savesMade)} />
      </div>

      <div className="mt-5 bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">Logins — last 7 days</div>
        <Sparkline data={u.spark} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Full compile-check + test suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc PASS (all admin components now resolve); full Vitest suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/LoginTrendChart.tsx src/components/admin/Sparkline.tsx "src/app/admin/analytics/[userId]/page.tsx"
git commit -m "feat(analytics): login trend chart, per-user sparkline, and user detail page"
```

---

### Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites PASS (including the four new `src/__tests__/analytics/*` files).

- [ ] **Step 2: Production build (stop the dev server first — Windows `.next` lock)**

Run: `npm run build`
Expected: build succeeds; `/admin/analytics` and `/admin/analytics/[userId]` appear in the route list with no type errors.

- [ ] **Step 3: Manual smoke (dev server)**

Start the dev server only if the user asks (per project memory, never auto-start). Then verify:
- `/listings/<an active listing>` shows the stat strip (Days listed / Views / Saves); a fresh view from a non-seller, non-admin account increments Views by 1; a refresh same-day does not.
- `/admin/analytics` shows summary cards, the 30-day trend chart, and the sortable/searchable user table; clicking a row opens the per-user detail page.

- [ ] **Step 4: (No commit — verification only.)**

---

## Self-Review

**Spec coverage:**
- `listing_views` + unique-per-day → Task 1 (table) + Task 4 (recording). ✓
- `login_events` + denormalized counters → Task 1 + Task 5. ✓
- `listings.listedAt` set-once + backfill → Task 1 (column + backfill) + Task 3 (both transition paths). ✓
- Public stat strip (Version A), old pills removed, cards untouched → Task 6. ✓
- Admin tab Option B: nav + summary cards + 30-day trend chart + sortable table + per-user sparkline + per-user detail + launch-accrual note → Tasks 7–9. ✓
- Derived metrics (saves / reach-outs / inquiries-received / listings-posted) → Task 7 (admin) + Task 6 (per-listing saves). ✓
- View gating excludes seller + admins → Task 2 (`shouldRecordView`) + Task 4. ✓
- Testing: dedup/exclusion (Task 4 mocked), listedAt set-once (Task 2 + Task 3), days-listed math (Task 2), trend zero-fill (Task 7). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command shows expected output.

**Type consistency:** `recordListingView`, `recordLogin`, `daysListed`, `shouldRecordView`, `nextListedAt`, `fillTrend`, `getAnalyticsSummary`, `getUserAnalytics`, `getLoginTrend`, and the `AnalyticsSummary` / `UserAnalyticsRow` / `LoginTrendPoint` interfaces are named identically across producing and consuming tasks. `StatStrip` and `AnalyticsDashboard`/`LoginTrendChart`/`Sparkline` props match their call sites. One ordering note is called out in Task 8 Step 4 (LoginTrendChart/Sparkline land in Task 9).
