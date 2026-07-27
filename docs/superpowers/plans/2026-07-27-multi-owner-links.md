# Multi-Owner Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one user hold many owner profiles, so owners who appear in the directory under several `owner_identifier` values (Austin Towns, and two others) stop silently losing locations.

**Architecture:** Replace the scalar `users.ownerIdentifier` / `users.ownerLinkSource` pair with a `user_owner_links` join table (one row per user↔owner, `source` ∈ `auto` | `manual` | `revoked`). Login reconciles a user's `auto` links against every directory email match; admin `manual` adds and `revoked` suppressions are durable. Every read path widens from string equality to set membership.

**Tech Stack:** Next.js App Router (server components + server actions), Drizzle ORM on Neon HTTP, NextAuth v5 with the Drizzle adapter, Vitest (node environment), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-07-27-multi-owner-links-design.md`

## Global Constraints

- **Verification gates are `npx tsc --noEmit` and `npx vitest run`.** Do NOT run `next build` — the `.next` directory is locked while a dev server runs on this Windows machine. Do NOT run `npm run lint` — it is broken pre-existing and unrelated to this change.
- **Never start a dev server.** Do not run `npm run dev` at any point.
- **The Neon HTTP driver has no `db.transaction`.** Use `db.batch([q1, q2])` for atomic multi-writes. `db.batch` requires a non-empty array, so branch on operation count rather than passing a possibly-empty array.
- **Do NOT run `npm run db:push`.** `scripts/db-push-guard.mjs` blocks it against non-local databases by design.
- **Do NOT run `npm run db:generate`.** Verified 2026-07-27: `drizzle/meta/0004_snapshot.json` omits `owner_locations` entirely and lists `public.users` with only `id, name, email, email_verified, image, role, seller_access, created_at`. A whole-schema diff would try to re-create drifted objects and hit interactive prompts. Migrations in this plan are **hand-authored** (the `0002` / `0004` pattern).
- **Do NOT run `npm run db:migrate` against the real database.** Migration application is the user's call; the plan stops at authored, reviewed artifacts. Same for the backfill script — write it, unit-test its pure core, do not execute it against prod.
- `UNKNOWN_OWNER` is the literal string `"Unknown Owner"` (`src/lib/owner-directory/query.ts:16`). It must never become an effective link.
- Existing files use double quotes, no semicolons at statement ends are NOT the style — this repo uses **double quotes and no trailing semicolons**. Match the surrounding file exactly.
- Commit after every task. Branch is `feat/multi-owner-links`, already created from `origin/main`.
- **Out of scope — do not "fix" these.** Two real problems are source-data tasks, not code: Lisa Lines cannot see the `ut-lines-towns` locations (no directory row carries their email), and Austin's GA Alpharetta location sits under `Unknown Owner`, which is unlinkable by design. Do not add code paths to work around either.

## File Structure

**PR 1 — additive (this plan, Tasks 1–11)**

| File | Responsibility |
| --- | --- |
| `src/db/schema/userOwnerLinks.ts` | *Create.* The `user_owner_links` table, `OWNER_LINK_SOURCES`, row types. |
| `src/db/schema.ts` | *Modify.* Export the new schema module. |
| `drizzle/0005_user_owner_links.sql` | *Create.* Hand-authored DDL. |
| `drizzle/meta/_journal.json` | *Modify.* Append the `0005` entry. |
| `drizzle/meta/0005_snapshot.json` | *Create.* Copy of `0004` plus the new table. |
| `src/__tests__/db/migration-artifacts.test.ts` | *Create.* Guards the hand-authored journal/snapshot chain. |
| `src/lib/owner-directory/link.ts` | *Rewrite.* `planOwnerLinks` — pure set reconciler. |
| `src/lib/owner-directory/links.ts` | *Create.* Query layer for the join table (`getEffectiveOwnerIdentifiers`, `getUserOwnerLinks`). |
| `src/lib/owner-directory/login.ts` | *Modify.* Apply the plan at sign-in. |
| `src/lib/owner-directory/data.ts` | *Modify.* `getMyOwnerLocations` set-scoped; `listUsersWithLinks` joins links. |
| `src/lib/owner-directory/actions.ts` | *Modify.* `addOwnerLink` / `revokeOwnerLink` / `clearOwnerLink`. |
| `src/lib/owner-directory/admin-view.ts` | *Create.* Pure view-model logic for the admin panel (node-testable). |
| `src/lib/owner-directory/backfill.ts` | *Create.* Pure legacy-state → link-rows mapping. |
| `scripts/backfill-user-owner-links.ts` | *Create.* The runnable backfill, using the pure mapping. |
| `src/lib/kpi/access.ts` | *Modify.* `canOwnerFetchLiveData` takes a set. |
| `src/lib/kpi/fetch.ts` | *Modify.* `fetchOwnerLocationKpis` parameter rename. |
| `src/lib/navigation.ts` | *Modify.* `isOwner` from array length. |
| `src/auth.ts`, `src/types/next-auth.d.ts` | *Modify.* Session carries `ownerIdentifiers: string[]`. |
| `src/components/layout/SiteHeader.tsx` | *Modify.* Pass the array through. |
| `src/components/admin/OwnerDirectory.tsx` | *Modify.* Chip rendering. |
| `src/app/admin/owner-directory/page.tsx` | *Modify.* Multi-link count in props. |
| `src/app/account/locations/page.tsx` | *Modify.* `ownerIdentifiers.length` empty check. |
| `src/app/account/locations/[id]/page.tsx` | *Modify.* Pass the array to the KPI fetch. |

**PR 2 — destructive (Task 12, after PR 1 ships and is verified in prod)**

| File | Responsibility |
| --- | --- |
| `src/db/schema/auth.ts` | *Modify.* Remove the two scalar columns and their index. |
| `drizzle/0006_drop_users_owner_scalars.sql` + meta | *Create.* `DROP COLUMN IF EXISTS`. |

---

### Task 1: `user_owner_links` schema + hand-authored migration

**Files:**
- Create: `src/db/schema/userOwnerLinks.ts`
- Modify: `src/db/schema.ts:19` (add export after the owner-directory line)
- Create: `drizzle/0005_user_owner_links.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0005_snapshot.json`
- Test: `src/__tests__/db/migration-artifacts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `userOwnerLinks` table object; `OWNER_LINK_SOURCES: readonly ["auto","manual","revoked"]`; `type OwnerLinkSource = "auto" | "manual" | "revoked"`; `type UserOwnerLink` (`$inferSelect`); `type NewUserOwnerLink` (`$inferInsert`). Columns: `id`, `userId`, `ownerIdentifier`, `source`, `createdAt`, `updatedAt`, `actorUserId`.

The test here guards the hand-authored artifacts, which is where this kind of change actually breaks: a `when` that isn't greater than the last applied one means `npm run db:migrate` silently skips the migration.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/db/migration-artifacts.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import journal from "../../../drizzle/meta/_journal.json"

const DRIZZLE = path.resolve(import.meta.dirname, "../../../drizzle")

describe("hand-authored migration artifacts", () => {
  it("has a .sql file for every journal entry", () => {
    for (const entry of journal.entries) {
      expect(existsSync(path.join(DRIZZLE, `${entry.tag}.sql`)), `${entry.tag}.sql`).toBe(true)
    }
  })

  it("has strictly increasing idx and when (the migrator keys off when)", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      expect(journal.entries[i].idx).toBe(journal.entries[i - 1].idx + 1)
      expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when)
    }
  })

  it("chains snapshot prevId to the previous snapshot id", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = JSON.parse(
        readFileSync(path.join(DRIZZLE, "meta", `${String(i - 1).padStart(4, "0")}_snapshot.json`), "utf8")
      )
      const cur = JSON.parse(
        readFileSync(path.join(DRIZZLE, "meta", `${String(i).padStart(4, "0")}_snapshot.json`), "utf8")
      )
      expect(cur.prevId).toBe(prev.id)
      expect(cur.id).not.toBe(prev.id)
    }
  })

  it("records user_owner_links in the latest snapshot", () => {
    const latest = journal.entries.length - 1
    const snap = JSON.parse(
      readFileSync(path.join(DRIZZLE, "meta", `${String(latest).padStart(4, "0")}_snapshot.json`), "utf8")
    )
    const table = snap.tables["public.user_owner_links"]
    expect(table).toBeDefined()
    expect(Object.keys(table.columns).sort()).toEqual([
      "actor_user_id", "created_at", "id", "owner_identifier", "source", "updated_at", "user_id",
    ])
    expect(table.indexes["user_owner_links_user_owner_idx"].isUnique).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/db/migration-artifacts.test.ts`
Expected: the first three tests PASS (existing chain is valid); `records user_owner_links in the latest snapshot` FAILS with `expected undefined to be defined`.

- [ ] **Step 3: Create the schema module**

Create `src/db/schema/userOwnerLinks.ts`:

```ts
import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { users } from "./auth"

/**
 * A user's link to an owner_identifier. Replaces the old scalar
 * users.owner_identifier / users.owner_link_source pair so one user can hold
 * several owner profiles (real owners appear in the directory under one
 * identifier per co-ownership grouping).
 *
 *   auto    - derived from the directory email match; re-reconciled every login
 *   manual  - added by an admin; the auto matcher never overwrites it
 *   revoked - admin suppression; the auto matcher must skip this owner
 *
 * EFFECTIVE links are source IN ('auto','manual'). One row per (user, owner)
 * so "linked and revoked at once" is unrepresentable.
 *
 * owner_identifier is a SOFT reference, not an FK: owner_locations has no
 * unique constraint on owner_identifier alone (its unique index is
 * (owner_identifier, blvd_location_name)) and the sync full-refreshes rows.
 * A link can therefore outlive its directory rows — surface that in admin UI
 * rather than assuming it cannot happen.
 */
export const OWNER_LINK_SOURCES = ["auto", "manual", "revoked"] as const
export type OwnerLinkSource = (typeof OWNER_LINK_SOURCES)[number]

export const userOwnerLinks = pgTable(
  "user_owner_links",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ownerIdentifier: text("owner_identifier").notNull(),
    source: text("source", { enum: OWNER_LINK_SOURCES }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    // The admin who added or revoked; null for auto links.
    actorUserId: text("actor_user_id").references(() => users.id),
  },
  (table) => [
    uniqueIndex("user_owner_links_user_owner_idx").on(
      table.userId,
      table.ownerIdentifier,
    ),
    index("user_owner_links_user_idx").on(table.userId),
  ],
)

export type UserOwnerLink = typeof userOwnerLinks.$inferSelect
export type NewUserOwnerLink = typeof userOwnerLinks.$inferInsert
```

- [ ] **Step 4: Export it from the schema barrel**

In `src/db/schema.ts`, after line 19 (`export * from "./schema/ownerLocations"`), add:

```ts
export * from "./schema/userOwnerLinks"
```

- [ ] **Step 5: Author the migration SQL**

Create `drizzle/0005_user_owner_links.sql`:

```sql
CREATE TABLE "user_owner_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"owner_identifier" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"actor_user_id" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_owner_links" ADD CONSTRAINT "user_owner_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_owner_links" ADD CONSTRAINT "user_owner_links_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "user_owner_links_user_owner_idx" ON "user_owner_links" USING btree ("user_id","owner_identifier");--> statement-breakpoint
CREATE INDEX "user_owner_links_user_idx" ON "user_owner_links" USING btree ("user_id");
```

Note the indentation inside `CREATE TABLE` is a literal TAB, matching `drizzle/0004_listing_disclaimer_acknowledgments.sql`.

- [ ] **Step 6: Append the journal entry**

In `drizzle/meta/_journal.json`, add this object to the end of `entries` (after the `0004` entry). `when` must exceed the last applied value `1783600000000`; `1785153600000` is 2026-07-27T12:00:00Z:

```json
    {
      "idx": 5,
      "version": "7",
      "when": 1785153600000,
      "tag": "0005_user_owner_links",
      "breakpoints": true
    }
```

- [ ] **Step 7: Create the snapshot**

Copy `drizzle/meta/0004_snapshot.json` to `drizzle/meta/0005_snapshot.json`, then make exactly three edits:

1. Set `"id"` to `"e7ce99ee-3f3d-4ceb-9f27-a32463a750fd"`.
2. Set `"prevId"` to `"9125f790-8d5c-46cc-9659-755f1b677fc9"` (the `id` of `0004_snapshot.json`).
3. Add this entry to the `"tables"` object:

```json
    "public.user_owner_links": {
      "name": "user_owner_links",
      "schema": "",
      "columns": {
        "id": { "name": "id", "type": "text", "primaryKey": true, "notNull": true },
        "user_id": { "name": "user_id", "type": "text", "primaryKey": false, "notNull": true },
        "owner_identifier": { "name": "owner_identifier", "type": "text", "primaryKey": false, "notNull": true },
        "source": { "name": "source", "type": "text", "primaryKey": false, "notNull": true },
        "created_at": { "name": "created_at", "type": "timestamp", "primaryKey": false, "notNull": true, "default": "now()" },
        "updated_at": { "name": "updated_at", "type": "timestamp", "primaryKey": false, "notNull": true, "default": "now()" },
        "actor_user_id": { "name": "actor_user_id", "type": "text", "primaryKey": false, "notNull": false }
      },
      "indexes": {
        "user_owner_links_user_owner_idx": {
          "name": "user_owner_links_user_owner_idx",
          "columns": [
            { "expression": "user_id", "isExpression": false, "asc": true, "nulls": "last" },
            { "expression": "owner_identifier", "isExpression": false, "asc": true, "nulls": "last" }
          ],
          "isUnique": true,
          "concurrently": false,
          "method": "btree",
          "with": {}
        },
        "user_owner_links_user_idx": {
          "name": "user_owner_links_user_idx",
          "columns": [
            { "expression": "user_id", "isExpression": false, "asc": true, "nulls": "last" }
          ],
          "isUnique": false,
          "concurrently": false,
          "method": "btree",
          "with": {}
        }
      },
      "foreignKeys": {
        "user_owner_links_user_id_users_id_fk": {
          "name": "user_owner_links_user_id_users_id_fk",
          "tableFrom": "user_owner_links",
          "tableTo": "users",
          "columnsFrom": ["user_id"],
          "columnsTo": ["id"],
          "onDelete": "cascade",
          "onUpdate": "no action"
        },
        "user_owner_links_actor_user_id_users_id_fk": {
          "name": "user_owner_links_actor_user_id_users_id_fk",
          "tableFrom": "user_owner_links",
          "tableTo": "users",
          "columnsFrom": ["actor_user_id"],
          "columnsTo": ["id"],
          "onDelete": "no action",
          "onUpdate": "no action"
        }
      },
      "compositePrimaryKeys": {},
      "uniqueConstraints": {},
      "policies": {},
      "checkConstraints": {},
      "isRLSEnabled": false
    },
```

This matches the key set `0004_snapshot.json` uses for its own tables exactly (`name, schema, columns, indexes, foreignKeys, compositePrimaryKeys, uniqueConstraints, policies, checkConstraints, isRLSEnabled`) — verified 2026-07-27. Do not add or omit keys.

- [ ] **Step 8: Run the tests and typecheck**

Run: `npx vitest run src/__tests__/db/migration-artifacts.test.ts`
Expected: all four tests PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/db/schema/userOwnerLinks.ts src/db/schema.ts drizzle/0005_user_owner_links.sql drizzle/meta/_journal.json drizzle/meta/0005_snapshot.json src/__tests__/db/migration-artifacts.test.ts
git commit -m "feat(db): add user_owner_links table with hand-authored migration"
```

---

### Task 2: `planOwnerLinks` pure reconciler

**Files:**
- Rewrite: `src/lib/owner-directory/link.ts` (replaces `decideOwnerLink` entirely)
- Rewrite: `src/__tests__/owner-directory/link.test.ts`

**Interfaces:**
- Consumes: `OwnerLinkSource` from Task 1 (via `@/db/schema`).
- Produces:
  - `type ExistingOwnerLink = { ownerIdentifier: string; source: OwnerLinkSource }`
  - `type OwnerLinkPlan = { toAdd: string[]; toRemove: string[]; skipped: { ownerIdentifier: string; reason: "revoked" | "manual" }[] }`
  - `function planOwnerLinks(args: { matchedOwnerIdentifiers: string[]; existingLinks: ExistingOwnerLink[] }): OwnerLinkPlan`
  - `const EMPTY_OWNER_LINK_PLAN: OwnerLinkPlan`
  - `function isEffectiveLinkSource(source: OwnerLinkSource): boolean`

`decideOwnerLink` and its `OwnerLinkDecision` type are deleted. Nothing outside `login.ts` and the test file imports them (verified by grep), so no other call sites need updating.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `src/__tests__/owner-directory/link.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  planOwnerLinks,
  isEffectiveLinkSource,
  type ExistingOwnerLink,
} from "@/lib/owner-directory/link"

describe("isEffectiveLinkSource", () => {
  it.each([
    ["auto", true],
    ["manual", true],
    ["revoked", false],
  ] as const)("%s -> %s", (source, expected) => {
    expect(isEffectiveLinkSource(source)).toBe(expected)
  })
})

describe("planOwnerLinks reconciliation rules", () => {
  it("adds a matched owner with no existing row", () => {
    expect(planOwnerLinks({ matchedOwnerIdentifiers: ["ut-towns"], existingLinks: [] })).toEqual({
      toAdd: ["ut-towns"],
      toRemove: [],
      skipped: [],
    })
  })

  it("leaves a matched owner that is already auto (idempotent)", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["ut-towns"],
        existingLinks: [{ ownerIdentifier: "ut-towns", source: "auto" }],
      })
    ).toEqual({ toAdd: [], toRemove: [], skipped: [] })
  })

  it("never downgrades a matched manual link to auto", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["ut-towns"],
        existingLinks: [{ ownerIdentifier: "ut-towns", source: "manual" }],
      })
    ).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [{ ownerIdentifier: "ut-towns", reason: "manual" }],
    })
  })

  it("skips a matched owner the admin revoked", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["ut-towns"],
        existingLinks: [{ ownerIdentifier: "ut-towns", source: "revoked" }],
      })
    ).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [{ ownerIdentifier: "ut-towns", reason: "revoked" }],
    })
  })

  it("removes an auto link the directory no longer matches", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: [],
        existingLinks: [{ ownerIdentifier: "stale-owner", source: "auto" }],
      })
    ).toEqual({ toAdd: [], toRemove: ["stale-owner"], skipped: [] })
  })

  it("keeps an unmatched manual link (manual is durable)", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: [],
        existingLinks: [{ ownerIdentifier: "hand-added", source: "manual" }],
      })
    ).toEqual({ toAdd: [], toRemove: [], skipped: [] })
  })

  it("keeps an unmatched revoked link (suppression is durable)", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: [],
        existingLinks: [{ ownerIdentifier: "suppressed", source: "revoked" }],
      })
    ).toEqual({ toAdd: [], toRemove: [], skipped: [] })
  })
})

describe("planOwnerLinks properties", () => {
  it("collapses duplicate matches (one owner, several directory rows)", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["az-corp", "az-corp", "az-corp"],
        existingLinks: [],
      })
    ).toEqual({ toAdd: ["az-corp"], toRemove: [], skipped: [] })
  })

  it("is idempotent: applying a plan then re-planning yields an empty plan", () => {
    const matched = ["ut-lines-towns", "ut-towns"]
    const first = planOwnerLinks({ matchedOwnerIdentifiers: matched, existingLinks: [] })
    // Simulate applying `first`: every added owner is now an auto link.
    const applied: ExistingOwnerLink[] = first.toAdd.map((ownerIdentifier) => ({
      ownerIdentifier,
      source: "auto",
    }))
    expect(planOwnerLinks({ matchedOwnerIdentifiers: matched, existingLinks: applied })).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [],
    })
  })

  it("links Austin Towns to BOTH Utah owner profiles (the reported bug)", () => {
    // Real data: austin@hellosugar.salon is the contact on ut-lines-towns (8
    // locations) and ut-towns (1). The old decideOwnerLink skipped him entirely
    // with reason "multiple_owners"; both must now be linked.
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["ut-lines-towns", "ut-towns"],
        existingLinks: [],
      })
    ).toEqual({ toAdd: ["ut-lines-towns", "ut-towns"], toRemove: [], skipped: [] })
  })

  it("handles a mixed set in one pass", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["fresh", "already-auto", "hand-added", "suppressed"],
        existingLinks: [
          { ownerIdentifier: "already-auto", source: "auto" },
          { ownerIdentifier: "hand-added", source: "manual" },
          { ownerIdentifier: "suppressed", source: "revoked" },
          { ownerIdentifier: "stale", source: "auto" },
        ],
      })
    ).toEqual({
      toAdd: ["fresh"],
      toRemove: ["stale"],
      skipped: [
        { ownerIdentifier: "hand-added", reason: "manual" },
        { ownerIdentifier: "suppressed", reason: "revoked" },
      ],
    })
  })

  it("returns empty for no matches and no existing links", () => {
    expect(planOwnerLinks({ matchedOwnerIdentifiers: [], existingLinks: [] })).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/owner-directory/link.test.ts`
Expected: FAIL — `planOwnerLinks` / `isEffectiveLinkSource` are not exported from `@/lib/owner-directory/link`.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/lib/owner-directory/link.ts`:

```ts
import type { OwnerLinkSource } from "@/db/schema"

/** A link row as the reconciler sees it — identifier plus current state. */
export type ExistingOwnerLink = {
  ownerIdentifier: string
  source: OwnerLinkSource
}

/**
 * What login should do to a user's links. `skipped` is for observability only
 * (so "why isn't this owner linked?" is answerable from logs) — it is never
 * persisted and callers must not branch on it.
 */
export type OwnerLinkPlan = {
  toAdd: string[]
  toRemove: string[]
  skipped: { ownerIdentifier: string; reason: "revoked" | "manual" }[]
}

export const EMPTY_OWNER_LINK_PLAN: OwnerLinkPlan = { toAdd: [], toRemove: [], skipped: [] }

/** Effective links are the ones that grant access; revoked ones never do. */
export function isEffectiveLinkSource(source: OwnerLinkSource): boolean {
  return source === "auto" || source === "manual"
}

/**
 * Reconcile a user's auto links against the owner profiles their directory
 * email currently matches. Pure — no I/O.
 *
 *   match + no row    -> add as auto
 *   match + auto      -> leave (idempotent)
 *   match + manual    -> leave; never downgrade an admin's link to auto
 *   match + revoked   -> skip; an admin suppression outlives the directory
 *   no match + auto   -> REMOVE. This is what makes the system self-healing:
 *                        correcting owner_contact_email in Monday drops the
 *                        bad link on the user's next login, with no admin
 *                        action. Without it, a wrong email grants access
 *                        permanently.
 *   no match + manual -> leave (durable by design)
 *   no match + revoked-> leave (durable by design)
 *
 * `matchedOwnerIdentifiers` MUST already exclude the "Unknown Owner" bucket —
 * those rows are never assignable to a user even when they carry an email.
 * Duplicates are fine; they are collapsed here.
 *
 * Outputs are sorted so callers and tests see a stable order regardless of
 * how the directory query happened to return rows.
 */
export function planOwnerLinks(args: {
  matchedOwnerIdentifiers: string[]
  existingLinks: ExistingOwnerLink[]
}): OwnerLinkPlan {
  const matched = new Set(args.matchedOwnerIdentifiers)
  const sourceByOwner = new Map(args.existingLinks.map((l) => [l.ownerIdentifier, l.source]))

  const toAdd: string[] = []
  const skipped: OwnerLinkPlan["skipped"] = []

  for (const ownerIdentifier of matched) {
    const source = sourceByOwner.get(ownerIdentifier)
    if (source === undefined) {
      toAdd.push(ownerIdentifier)
    } else if (source === "revoked") {
      skipped.push({ ownerIdentifier, reason: "revoked" })
    } else if (source === "manual") {
      skipped.push({ ownerIdentifier, reason: "manual" })
    }
    // source === "auto" -> already correct; nothing to do.
  }

  const toRemove = args.existingLinks
    .filter((l) => l.source === "auto" && !matched.has(l.ownerIdentifier))
    .map((l) => l.ownerIdentifier)

  const byOwner = (a: { ownerIdentifier: string }, b: { ownerIdentifier: string }) =>
    a.ownerIdentifier.localeCompare(b.ownerIdentifier)

  return {
    toAdd: toAdd.sort((a, b) => a.localeCompare(b)),
    toRemove: toRemove.sort((a, b) => a.localeCompare(b)),
    skipped: skipped.sort(byOwner),
  }
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/__tests__/owner-directory/link.test.ts`
Expected: all tests PASS.

Run: `npx tsc --noEmit`
Expected: ONE error, in `src/lib/owner-directory/login.ts` — it still imports the deleted `decideOwnerLink`. Task 3 fixes it. Do not patch it here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/owner-directory/link.ts src/__tests__/owner-directory/link.test.ts
git commit -m "feat(owner-links): replace decideOwnerLink with planOwnerLinks set reconciler"
```

---

### Task 3: Link query layer + apply the plan at login

**Files:**
- Create: `src/lib/owner-directory/links.ts`
- Modify: `src/lib/owner-directory/login.ts` (full rewrite of `linkOwnerAtLogin`)
- Test: `src/__tests__/owner-directory/login.test.ts` (create)

**Interfaces:**
- Consumes: `planOwnerLinks`, `EMPTY_OWNER_LINK_PLAN`, `isEffectiveLinkSource`, `ExistingOwnerLink`, `OwnerLinkPlan` (Task 2); `userOwnerLinks`, `OwnerLinkSource` (Task 1); `normalizeEmail` (`./email`); `UNKNOWN_OWNER` (`./query`).
- Produces:
  - `links.ts`: `async function getEffectiveOwnerIdentifiers(userId: string): Promise<string[]>`, `async function getUserOwnerLinks(userId: string): Promise<ExistingOwnerLink[]>`
  - `login.ts`: `async function linkOwnerAtLogin(userId: string, email: string | null | undefined): Promise<OwnerLinkPlan>` (return type changed from `OwnerLinkDecision`)

- [ ] **Step 1: Create the shared mock-query helper**

Tasks 3, 6 and 9 all need the same chainable Drizzle stub, so it lives in one place. Create `test/helpers/drizzle-mock.ts` (sibling of the existing `test/stubs/server-only.ts`):

```ts
/**
 * A thenable stand-in for a Drizzle query builder: every chained method
 * returns the same object, and awaiting it resolves to `result`. Lets a test
 * stub `db.select()` without modelling the builder's real types.
 *
 * Add to CHAINED_METHODS when a test needs a builder method not listed here.
 */
const CHAINED_METHODS = [
  "from",
  "where",
  "orderBy",
  "leftJoin",
  "limit",
  "values",
  "set",
  "onConflictDoUpdate",
] as const

export function builder(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const method of CHAINED_METHODS) b[method] = () => b
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return b
}
```

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/owner-directory/login.test.ts`, importing the helper above:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const selectDistinct = vi.fn()
const select = vi.fn()
const insert = vi.fn()
const del = vi.fn()
const batch = vi.fn()

vi.mock("@/db", () => ({
  db: {
    selectDistinct: (...a: unknown[]) => selectDistinct(...a),
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
    delete: (...a: unknown[]) => del(...a),
    batch: (...a: unknown[]) => batch(...a),
  },
}))

const MATCHES = [{ ownerIdentifier: "ut-lines-towns" }, { ownerIdentifier: "ut-towns" }]

describe("linkOwnerAtLogin", () => {
  beforeEach(() => {
    vi.resetModules()
    for (const m of [selectDistinct, select, insert, del, batch]) m.mockReset()
  })

  it("links a user to every owner profile their email matches", async () => {
    selectDistinct.mockReturnValue(builder(MATCHES))
    select.mockReturnValue(builder([])) // no existing links
    insert.mockReturnValue(builder(undefined))

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    const plan = await linkOwnerAtLogin("user-1", "Austin@hellosugar.salon")

    expect(plan.toAdd).toEqual(["ut-lines-towns", "ut-towns"])
    expect(insert).toHaveBeenCalledTimes(1)
    expect(batch).not.toHaveBeenCalled() // add-only needs no batch
  })

  it("batches an add and a remove together", async () => {
    selectDistinct.mockReturnValue(builder([{ ownerIdentifier: "fresh" }]))
    select.mockReturnValue(builder([{ ownerIdentifier: "stale", source: "auto" }]))
    insert.mockReturnValue(builder(undefined))
    del.mockReturnValue(builder(undefined))

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    const plan = await linkOwnerAtLogin("user-1", "a@b.com")

    expect(plan.toAdd).toEqual(["fresh"])
    expect(plan.toRemove).toEqual(["stale"])
    expect(batch).toHaveBeenCalledTimes(1)
  })

  it("writes nothing when the plan is empty", async () => {
    selectDistinct.mockReturnValue(builder([{ ownerIdentifier: "same" }]))
    select.mockReturnValue(builder([{ ownerIdentifier: "same", source: "auto" }]))

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    await linkOwnerAtLogin("user-1", "a@b.com")

    expect(insert).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(batch).not.toHaveBeenCalled()
  })

  it("returns an empty plan and queries nothing for a blank email", async () => {
    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    expect(await linkOwnerAtLogin("user-1", "   ")).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [],
    })
    expect(selectDistinct).not.toHaveBeenCalled()
  })

  it("never throws when the database fails (must not block sign-in)", async () => {
    selectDistinct.mockImplementation(() => {
      throw new Error("neon exploded")
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { linkOwnerAtLogin } = await import("@/lib/owner-directory/login")
    await expect(linkOwnerAtLogin("user-1", "a@b.com")).resolves.toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [],
    })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/owner-directory/login.test.ts`
Expected: FAIL — the current `linkOwnerAtLogin` imports the deleted `decideOwnerLink`, so the module fails to load.

- [ ] **Step 3: Create the link query layer**

Create `src/lib/owner-directory/links.ts`:

```ts
import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { userOwnerLinks } from "@/db/schema"
import type { ExistingOwnerLink } from "./link"

/** Sources that grant access. Kept in sync with isEffectiveLinkSource. */
const EFFECTIVE_SOURCES = ["auto", "manual"] as const

/**
 * Every link row for a user, including revoked ones — the reconciler needs
 * revocations to know what to skip.
 */
export async function getUserOwnerLinks(userId: string): Promise<ExistingOwnerLink[]> {
  return db
    .select({
      ownerIdentifier: userOwnerLinks.ownerIdentifier,
      source: userOwnerLinks.source,
    })
    .from(userOwnerLinks)
    .where(eq(userOwnerLinks.userId, userId))
}

/**
 * The owner identifiers a user effectively holds. Revoked links are excluded
 * in the QUERY, not by the caller, so no read path can accidentally honour a
 * suppression.
 */
export async function getEffectiveOwnerIdentifiers(userId: string): Promise<string[]> {
  const rows = await db
    .select({ ownerIdentifier: userOwnerLinks.ownerIdentifier })
    .from(userOwnerLinks)
    .where(
      and(
        eq(userOwnerLinks.userId, userId),
        inArray(userOwnerLinks.source, [...EFFECTIVE_SOURCES]),
      ),
    )
  return rows.map((r) => r.ownerIdentifier)
}
```

- [ ] **Step 4: Rewrite `linkOwnerAtLogin`**

Replace the entire contents of `src/lib/owner-directory/login.ts`:

```ts
import "server-only"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "@/db"
import { ownerLocations, userOwnerLinks } from "@/db/schema"
import { normalizeEmail } from "./email"
import { UNKNOWN_OWNER } from "./query"
import { planOwnerLinks, EMPTY_OWNER_LINK_PLAN, type OwnerLinkPlan } from "./link"

/**
 * Additive login step: reconcile the user's auto links against every owner
 * profile their directory email matches. A user may hold several profiles —
 * owners appear once per co-ownership grouping — so a multi-match is normal,
 * not ambiguous.
 *
 * Never throws and never blocks sign-in: failures are logged and swallowed so
 * a directory hiccup can never lock anyone out.
 */
export async function linkOwnerAtLogin(
  userId: string,
  email: string | null | undefined
): Promise<OwnerLinkPlan> {
  try {
    const normalized = normalizeEmail(email)
    if (!normalized) return EMPTY_OWNER_LINK_PLAN

    const [matches, existingLinks] = await Promise.all([
      // Distinct owners for this email, excluding the never-linkable bucket.
      db
        .selectDistinct({ ownerIdentifier: ownerLocations.ownerIdentifier })
        .from(ownerLocations)
        .where(
          and(
            eq(ownerLocations.ownerContactEmailNormalized, normalized),
            ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER)
          )
        ),
      db
        .select({
          ownerIdentifier: userOwnerLinks.ownerIdentifier,
          source: userOwnerLinks.source,
        })
        .from(userOwnerLinks)
        .where(eq(userOwnerLinks.userId, userId)),
    ])

    const plan = planOwnerLinks({
      matchedOwnerIdentifiers: matches.map((m) => m.ownerIdentifier),
      existingLinks,
    })

    const addOp =
      plan.toAdd.length > 0
        ? db.insert(userOwnerLinks).values(
            plan.toAdd.map((ownerIdentifier) => ({
              userId,
              ownerIdentifier,
              source: "auto" as const,
            }))
          )
        : null

    // eq(source, "auto") is a deliberate belt-and-braces guard: toRemove only
    // ever holds auto links, but a manual or revoked row must never be deleted
    // by the automatic path even if that invariant is broken upstream.
    const removeOp =
      plan.toRemove.length > 0
        ? db
            .delete(userOwnerLinks)
            .where(
              and(
                eq(userOwnerLinks.userId, userId),
                eq(userOwnerLinks.source, "auto"),
                inArray(userOwnerLinks.ownerIdentifier, plan.toRemove)
              )
            )
        : null

    // The Neon HTTP driver has no db.transaction; db.batch is the atomic
    // multi-write primitive and rejects an empty array, so branch explicitly.
    if (addOp && removeOp) await db.batch([addOp, removeOp])
    else if (addOp) await addOp
    else if (removeOp) await removeOp

    if (plan.skipped.length > 0) {
      console.info(
        `[owner-link] ${normalized}: skipped ${plan.skipped
          .map((s) => `${s.ownerIdentifier}(${s.reason})`)
          .join(", ")}`
      )
    }
    return plan
  } catch (err) {
    console.warn("[owner-link] linkOwnerAtLogin failed (non-fatal):", err)
    return EMPTY_OWNER_LINK_PLAN
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/__tests__/owner-directory/login.test.ts src/__tests__/owner-directory/link.test.ts`
Expected: all PASS.

Run: `npx tsc --noEmit`
Expected: no errors from `link.ts` or `login.ts`. Errors may remain elsewhere only if you touched other files — you should not have.

- [ ] **Step 6: Commit**

```bash
git add src/lib/owner-directory/links.ts src/lib/owner-directory/login.ts src/__tests__/owner-directory/login.test.ts
git commit -m "feat(owner-links): reconcile all matching owner profiles at login"
```

---

### Task 4: Session carries `ownerIdentifiers`

**Files:**
- Modify: `src/auth.ts:44-52` (session callback)
- Modify: `src/types/next-auth.d.ts` (three interfaces)
- Test: `src/__tests__/auth.test.ts:150-176` (update the session-callback block)

**Interfaces:**
- Consumes: `getEffectiveOwnerIdentifiers` (Task 3).
- Produces: `session.user.ownerIdentifiers: string[]` — always an array, never null/undefined. Tasks 5, 6, 7 and both account pages read it.

The old `session.user.ownerIdentifier` is removed, not deprecated in place. Keeping both would be the dual-source-of-truth this change exists to delete.

- [ ] **Step 1: Update the failing test**

In `src/__tests__/auth.test.ts`, add this mock alongside the file's existing `vi.mock` calls (near the top, before the `describe` blocks):

```ts
const getEffectiveOwnerIdentifiers = vi.fn()
vi.mock("@/lib/owner-directory/links", () => ({
  getEffectiveOwnerIdentifiers,
  getUserOwnerLinks: vi.fn(),
}))
```

Then replace the whole `describe("auth session callback (real src/auth.ts)")` block (lines 150-176) with:

```ts
describe("auth session callback (real src/auth.ts)", () => {
  it("propagates id, role, sellerAccess, and ownerIdentifiers onto the session user", async () => {
    getEffectiveOwnerIdentifiers.mockResolvedValue(["ut-lines-towns", "ut-towns"])
    const session = { user: { name: "Jane", email: "jane@hellosugar.salon" } }
    const result = await sessionCallback({
      session,
      user: { id: "user-1", role: "admin", sellerAccess: true },
    })
    expect(result.user.id).toBe("user-1")
    expect(result.user.role).toBe("admin")
    expect(result.user.sellerAccess).toBe(true)
    expect(result.user.ownerIdentifiers).toEqual(["ut-lines-towns", "ut-towns"])
    expect(getEffectiveOwnerIdentifiers).toHaveBeenCalledWith("user-1")
  })

  it("gives an unlinked user an empty array, not null", async () => {
    getEffectiveOwnerIdentifiers.mockResolvedValue([])
    const result = await sessionCallback({
      session: { user: {} },
      user: { id: "user-2", role: "user", sellerAccess: false },
    })
    expect(result.user.ownerIdentifiers).toEqual([])
    expect(result.user.sellerAccess).toBe(false)
  })

  it("falls back to an empty array when the link lookup fails (never breaks the session)", async () => {
    getEffectiveOwnerIdentifiers.mockRejectedValue(new Error("neon exploded"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = await sessionCallback({
      session: { user: {} },
      user: { id: "user-3", role: "user", sellerAccess: false },
    })
    expect(result.user.ownerIdentifiers).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/auth.test.ts`
Expected: FAIL — `result.user.ownerIdentifiers` is `undefined`.

- [ ] **Step 3: Update the session callback**

In `src/auth.ts`, add the import next to the existing `linkOwnerAtLogin` import (line 7):

```ts
import { getEffectiveOwnerIdentifiers } from "@/lib/owner-directory/links"
```

Replace the `session` callback (lines 44-52) with:

```ts
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
        session.user.role = user.role
        session.user.sellerAccess = user.sellerAccess
        // Owner links live in user_owner_links (a user may hold several owner
        // profiles), so this is one indexed lookup rather than a column on the
        // adapter's user row. Read fresh so an admin revoke takes effect on the
        // next page load instead of requiring sign-out. A failure must degrade
        // to "not an owner", never break the session.
        try {
          session.user.ownerIdentifiers = await getEffectiveOwnerIdentifiers(user.id)
        } catch (err) {
          console.warn("[owner-link] session owner lookup failed (non-fatal):", err)
          session.user.ownerIdentifiers = []
        }
      }
      return session
    },
```

- [ ] **Step 4: Update the session types**

In `src/types/next-auth.d.ts`, replace `ownerIdentifier?: string | null` with `ownerIdentifiers?: string[]` in all three places — `interface User` (line 7), `interface Session`'s `user` (line 14), and `interface AdapterUser` (line 23).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/__tests__/auth.test.ts`
Expected: all three new cases PASS.

Run: `npx tsc --noEmit`
Expected: errors ONLY in the not-yet-migrated consumers — `src/lib/navigation.ts`, `src/components/layout/SiteHeader.tsx`, `src/app/account/locations/[id]/page.tsx`. Tasks 5-7 fix them.

- [ ] **Step 6: Commit**

```bash
git add src/auth.ts src/types/next-auth.d.ts src/__tests__/auth.test.ts
git commit -m "feat(auth): session carries ownerIdentifiers array"
```

---

### Task 5: Access gate takes a set

**Files:**
- Modify: `src/lib/kpi/access.ts:12-22`
- Modify: `src/lib/kpi/fetch.ts:197-214`
- Modify: `src/app/account/locations/[id]/page.tsx:46-50`
- Test: `src/__tests__/kpi/owner-access.test.ts` (rewrite)

**Interfaces:**
- Consumes: `session.user.ownerIdentifiers` (Task 4).
- Produces: `canOwnerFetchLiveData(rowOwnerIdentifier: string, sessionOwnerIdentifiers: readonly string[] | null | undefined, resolvedBqLocationName: string | null): boolean`; `fetchOwnerLocationKpis({ rowOwnerIdentifier, sessionOwnerIdentifiers, bqLocationName })`.

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `src/__tests__/kpi/owner-access.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { canOwnerFetchLiveData } from "@/lib/kpi/access"

describe("canOwnerFetchLiveData", () => {
  it("allows a row whose owner is in the session's set", () => {
    expect(canOwnerFetchLiveData("owner-1", ["owner-1"], "Sugar House")).toBe(true)
  })

  it("allows a multi-profile owner for EITHER of their profiles", () => {
    const mine = ["ut-lines-towns", "ut-towns"]
    expect(canOwnerFetchLiveData("ut-lines-towns", mine, "UT Park City | Kimball Junction 235")).toBe(true)
    expect(canOwnerFetchLiveData("ut-towns", mine, "UT Ogden | Riverdale 082")).toBe(true)
  })

  it.each([
    ["an owner outside the set", "owner-3", ["owner-1", "owner-2"], "Sugar House"],
    ["an empty set", "owner-1", [], "Sugar House"],
    ["a null set", "owner-1", null, "Sugar House"],
    ["an undefined set", "owner-1", undefined, "Sugar House"],
    ["no resolved bq name", "owner-1", ["owner-1"], null],
  ] as const)("blocks %s", (_label, row, session, bq) => {
    expect(canOwnerFetchLiveData(row, session, bq)).toBe(false)
  })

  it("does not match on a prefix or substring", () => {
    expect(canOwnerFetchLiveData("ut-towns", ["ut-lines-towns"], "Sugar House")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/kpi/owner-access.test.ts`
Expected: FAIL — the current signature takes a string, so passing arrays fails to typecheck and the array cases return `false`/`true` wrongly.

- [ ] **Step 3: Update the gate**

In `src/lib/kpi/access.ts`, replace `canOwnerFetchLiveData` (lines 6-22) with:

```ts
/**
 * Owner-scoped variant (parallel to the listing gate above, which is
 * unchanged): a linked owner may see live data for an owner_locations row
 * they own that has a resolved BigQuery name. The row must come from a
 * server-side owner-scoped query — never trust client-supplied identifiers.
 *
 * A user may hold several owner profiles, so this is set membership. The
 * `?.length` guard matters: `[]` must read as "not an owner", and `[]` is
 * truthy — a refactor to a bare truthiness check on the array would silently
 * open the gate.
 */
export function canOwnerFetchLiveData(
  rowOwnerIdentifier: string,
  sessionOwnerIdentifiers: readonly string[] | null | undefined,
  resolvedBqLocationName: string | null
): boolean {
  return (
    !!sessionOwnerIdentifiers?.length &&
    sessionOwnerIdentifiers.includes(rowOwnerIdentifier) &&
    !!resolvedBqLocationName
  )
}
```

- [ ] **Step 4: Update the KPI fetch and its caller**

In `src/lib/kpi/fetch.ts`, change the `fetchOwnerLocationKpis` argument type (line 199) from `sessionOwnerIdentifier: string | null` to:

```ts
  sessionOwnerIdentifiers: readonly string[]
```

and update the call inside it (lines 207-211) to pass `args.sessionOwnerIdentifiers`. Also update the doc comment above it (lines 193-194) to say "the session's owner identifiers" instead of "the session's ownerIdentifier".

In `src/app/account/locations/[id]/page.tsx`, change line 48 from
`sessionOwnerIdentifier: session.user.ownerIdentifier ?? null,` to:

```ts
    sessionOwnerIdentifiers: session.user.ownerIdentifiers ?? [],
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/__tests__/kpi/owner-access.test.ts`
Expected: all PASS.

Run: `npx tsc --noEmit`
Expected: remaining errors ONLY in `src/lib/navigation.ts` and `src/components/layout/SiteHeader.tsx` (Task 7) and `src/lib/owner-directory/data.ts` consumers (Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpi/access.ts src/lib/kpi/fetch.ts src/app/account/locations/[id]/page.tsx src/__tests__/kpi/owner-access.test.ts
git commit -m "feat(kpi): owner live-data gate uses set membership"
```

---

### Task 6: `getMyOwnerLocations` returns the merged set

**Files:**
- Modify: `src/lib/owner-directory/data.ts:15-40`
- Modify: `src/app/account/locations/page.tsx:26,34,40`
- Test: `src/__tests__/owner-directory/my-location.test.ts` (update mocks)
- Test: `src/__tests__/owner-directory/data.test.ts` (create)

**Interfaces:**
- Consumes: `getEffectiveOwnerIdentifiers` (Task 3), `UNKNOWN_OWNER` (`./query`).
- Produces: `getMyOwnerLocations(): Promise<{ ownerIdentifiers: string[]; locations: OwnerLocation[] }>` — the field is renamed from `ownerIdentifier` and is always an array.

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/owner-directory/data.test.ts`. The security property under test is that an empty owner set never reaches the location query. `builder` comes from the shared helper created in Task 3:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const auth = vi.fn()
vi.mock("@/auth", () => ({ auth }))

const getEffectiveOwnerIdentifiers = vi.fn()
vi.mock("@/lib/owner-directory/links", () => ({
  getEffectiveOwnerIdentifiers,
  getUserOwnerLinks: vi.fn(),
}))

const select = vi.fn()
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

describe("getMyOwnerLocations", () => {
  beforeEach(() => {
    vi.resetModules()
    auth.mockReset()
    getEffectiveOwnerIdentifiers.mockReset()
    select.mockReset()
  })

  it("returns the merged locations across every linked owner profile", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } })
    getEffectiveOwnerIdentifiers.mockResolvedValue(["ut-lines-towns", "ut-towns"])
    select.mockReturnValue(builder([{ id: "a" }, { id: "b" }]))

    const { getMyOwnerLocations } = await import("@/lib/owner-directory/data")
    const result = await getMyOwnerLocations()

    expect(result.ownerIdentifiers).toEqual(["ut-lines-towns", "ut-towns"])
    expect(result.locations).toHaveLength(2)
  })

  it("returns empty WITHOUT querying locations when the user has no links", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } })
    getEffectiveOwnerIdentifiers.mockResolvedValue([])

    const { getMyOwnerLocations } = await import("@/lib/owner-directory/data")
    expect(await getMyOwnerLocations()).toEqual({ ownerIdentifiers: [], locations: [] })
    expect(select).not.toHaveBeenCalled()
  })

  it("filters Unknown Owner out of the scope even if a link exists", async () => {
    auth.mockResolvedValue({ user: { id: "user-1" } })
    getEffectiveOwnerIdentifiers.mockResolvedValue(["Unknown Owner"])

    const { getMyOwnerLocations } = await import("@/lib/owner-directory/data")
    expect(await getMyOwnerLocations()).toEqual({ ownerIdentifiers: [], locations: [] })
    expect(select).not.toHaveBeenCalled()
  })

  it("returns empty for a signed-out visitor", async () => {
    auth.mockResolvedValue(null)

    const { getMyOwnerLocations } = await import("@/lib/owner-directory/data")
    expect(await getMyOwnerLocations()).toEqual({ ownerIdentifiers: [], locations: [] })
    expect(getEffectiveOwnerIdentifiers).not.toHaveBeenCalled()
  })
})
```

In `src/__tests__/owner-directory/my-location.test.ts`, change the three `getMyOwnerLocations.mockResolvedValue({...})` calls (lines 41, 51, 60) to use the new field name:

```ts
    // line 41
    getMyOwnerLocations.mockResolvedValue({
      ownerIdentifiers: ["owner-1"],
      locations: [ownerLoc({ id: "a" }), ownerLoc({ id: "b" })],
    })
    // line 51
    getMyOwnerLocations.mockResolvedValue({
      ownerIdentifiers: ["owner-1"],
      locations: [ownerLoc({ id: "a" })],
    })
    // line 60
    getMyOwnerLocations.mockResolvedValue({ ownerIdentifiers: [], locations: [] })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/owner-directory/data.test.ts`
Expected: FAIL — `getMyOwnerLocations` still returns `{ ownerIdentifier, locations }` and still reads `users.ownerIdentifier` from the DB.

- [ ] **Step 3: Rewrite `getMyOwnerLocations`**

In `src/lib/owner-directory/data.ts`, replace the imports and the function (lines 1-40). The `users` import stays — `listUsersWithLinks` still uses it:

```ts
import "server-only"
import { and, asc, eq, ilike, inArray, ne, or, type SQL } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { ownerLocations, type OwnerLocation } from "@/db/schema"
import { UNKNOWN_OWNER } from "./query"
import { getEffectiveOwnerIdentifiers } from "./links"

/**
 * The logged-in user's owned locations, scoped in the QUERY (not just the UI):
 * we read the user's own effective owner links from the DB and only ever
 * return rows for those owners. A user may hold several owner profiles, so
 * this is a merged set, ordered by location name — owner_identifier is
 * internal bookkeeping and never surfaces in owner-facing UI.
 *
 * Returns an empty result when the user isn't a linked owner. Unknown Owner is
 * never returned even if somehow linked.
 */
export async function getMyOwnerLocations(): Promise<{
  ownerIdentifiers: string[]
  locations: OwnerLocation[]
}> {
  const session = await auth()
  if (!session?.user?.id) return { ownerIdentifiers: [], locations: [] }

  const linked = await getEffectiveOwnerIdentifiers(session.user.id)
  const ownerIdentifiers = linked.filter((o) => o !== UNKNOWN_OWNER)

  // Explicit early return rather than relying on inArray(col, []) emitting a
  // false predicate — this is a security boundary, not a convenience.
  if (ownerIdentifiers.length === 0) return { ownerIdentifiers: [], locations: [] }

  const locations = await db
    .select()
    .from(ownerLocations)
    .where(inArray(ownerLocations.ownerIdentifier, ownerIdentifiers))
    .orderBy(asc(ownerLocations.blvdLocationName))

  return { ownerIdentifiers, locations }
}
```

- [ ] **Step 4: Update the account page**

In `src/app/account/locations/page.tsx`:
- Line 26: `const { ownerIdentifiers, locations } = await getMyOwnerLocations()`
- Line 34: `ownerIdentifiers.length > 0`
- Line 40: `{ownerIdentifiers.length === 0 || locations.length === 0 ? (`

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/__tests__/owner-directory/`
Expected: `data.test.ts`, `my-location.test.ts`, `link.test.ts`, `login.test.ts` all PASS.

Run: `npx tsc --noEmit`
Expected: remaining errors ONLY in `src/lib/navigation.ts` and `src/components/layout/SiteHeader.tsx` (Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/lib/owner-directory/data.ts src/app/account/locations/page.tsx src/__tests__/owner-directory/data.test.ts src/__tests__/owner-directory/my-location.test.ts
git commit -m "feat(account): My Locations merges all linked owner profiles"
```

---

### Task 7: Capabilities read the array

**Files:**
- Modify: `src/lib/navigation.ts:19-38`
- Modify: `src/components/layout/SiteHeader.tsx:18-22`
- Test: `src/__tests__/navigation.test.ts:19-22`

**Interfaces:**
- Consumes: `session.user.ownerIdentifiers` (Task 4).
- Produces: `SessionUserLike.ownerIdentifiers?: readonly string[] | null`. `deriveCapabilities` stays synchronous and pure; its return shape `{ isAdmin, hasSeller, isOwner }` is unchanged.

- [ ] **Step 1: Update the failing test**

In `src/__tests__/navigation.test.ts`, replace the `marks owner when ownerIdentifier present` case (lines 19-22) with:

```ts
  it("marks owner when any owner link is present", () => {
    const caps = deriveCapabilities({ role: "user", ownerIdentifiers: ["OWN-1"] })
    expect(caps.isOwner).toBe(true)
  })
  it("marks owner for a multi-profile owner", () => {
    const caps = deriveCapabilities({
      role: "user",
      ownerIdentifiers: ["ut-lines-towns", "ut-towns"],
    })
    expect(caps.isOwner).toBe(true)
  })
  it("is not an owner for an empty link array", () => {
    expect(deriveCapabilities({ role: "user", ownerIdentifiers: [] }).isOwner).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/navigation.test.ts`
Expected: FAIL — `ownerIdentifiers` is not a property of `SessionUserLike`.

- [ ] **Step 3: Update `navigation.ts`**

In `src/lib/navigation.ts`, change line 22 from `ownerIdentifier?: string | null` to:

```ts
  ownerIdentifiers?: readonly string[] | null
```

and line 36 from `isOwner: !!user.ownerIdentifier,` to:

```ts
    isOwner: !!user.ownerIdentifiers?.length,
```

- [ ] **Step 4: Update `SiteHeader.tsx`**

In `src/components/layout/SiteHeader.tsx`, change line 21 from `ownerIdentifier: user.ownerIdentifier,` to:

```ts
    ownerIdentifiers: user.ownerIdentifiers,
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/__tests__/navigation.test.ts`
Expected: all PASS.

Run: `npx tsc --noEmit`
Expected: **no errors at all.** This is the point where the whole app compiles against the new model. If any error remains, fix it before committing.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/navigation.ts src/components/layout/SiteHeader.tsx src/__tests__/navigation.test.ts
git commit -m "feat(nav): isOwner derives from the owner link array"
```

---

### Task 8: Admin view-model (pure) + `listUsersWithLinks`

**Files:**
- Create: `src/lib/owner-directory/admin-view.ts`
- Modify: `src/lib/owner-directory/data.ts` (`listUsersWithLinks`, lines 84-105)
- Test: `src/__tests__/owner-directory/admin-view.test.ts` (create)

**Interfaces:**
- Consumes: `OwnerLinkSource` (Task 1).
- Produces:
  - `type AdminOwnerLink = { ownerIdentifier: string; source: OwnerLinkSource }`
  - `type AdminUserRow = { id: string; name: string | null; email: string | null; links: AdminOwnerLink[] }`
  - `type FlatUserLinkRow = { id: string; name: string | null; email: string | null; ownerIdentifier: string | null; source: OwnerLinkSource | null }`
  - `function groupUserLinkRows(rows: FlatUserLinkRow[]): AdminUserRow[]`
  - `function linkSourceBadgeVariant(source: OwnerLinkSource): "default" | "primary" | "outline"`
  - `function countMultiLinkUsers(rows: AdminUserRow[]): number`
  - `function addableOwners<T extends { ownerIdentifier: string }>(all: T[], links: AdminOwnerLink[]): T[]`
  - `listUsersWithLinks(): Promise<AdminUserRow[]>`

This module exists because the repo has no React component testing — `vitest.config.mts` sets `environment: "node"` and includes only `**/*.test.ts`, and `@testing-library/react` / `jsdom` are not installed. Putting the logic here keeps it tested without adding a test stack as a side effect. `OwnerDirectory.tsx` (Task 9) keeps only rendering.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/owner-directory/admin-view.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  groupUserLinkRows,
  linkSourceBadgeVariant,
  countMultiLinkUsers,
  addableOwners,
  type AdminUserRow,
} from "@/lib/owner-directory/admin-view"

describe("groupUserLinkRows", () => {
  it("collapses a left-joined result into one row per user", () => {
    expect(
      groupUserLinkRows([
        { id: "u1", name: "Austin", email: "austin@x.com", ownerIdentifier: "ut-lines-towns", source: "auto" },
        { id: "u1", name: "Austin", email: "austin@x.com", ownerIdentifier: "ut-towns", source: "auto" },
        { id: "u2", name: "Lisa", email: "lisa@x.com", ownerIdentifier: "az-ut-lines", source: "manual" },
      ])
    ).toEqual([
      {
        id: "u1",
        name: "Austin",
        email: "austin@x.com",
        links: [
          { ownerIdentifier: "ut-lines-towns", source: "auto" },
          { ownerIdentifier: "ut-towns", source: "auto" },
        ],
      },
      { id: "u2", name: "Lisa", email: "lisa@x.com", links: [{ ownerIdentifier: "az-ut-lines", source: "manual" }] },
    ])
  })

  it("keeps a user with no links, with an empty array (left join yields nulls)", () => {
    expect(
      groupUserLinkRows([
        { id: "u3", name: "Buyer", email: "buyer@x.com", ownerIdentifier: null, source: null },
      ])
    ).toEqual([{ id: "u3", name: "Buyer", email: "buyer@x.com", links: [] }])
  })

  it("sorts links by identifier so chip order is stable", () => {
    const [row] = groupUserLinkRows([
      { id: "u1", name: null, email: null, ownerIdentifier: "z-owner", source: "auto" },
      { id: "u1", name: null, email: null, ownerIdentifier: "a-owner", source: "auto" },
    ])
    expect(row.links.map((l) => l.ownerIdentifier)).toEqual(["a-owner", "z-owner"])
  })

  it("preserves user order from the query", () => {
    const rows = groupUserLinkRows([
      { id: "b", name: null, email: "b@x.com", ownerIdentifier: null, source: null },
      { id: "a", name: null, email: "a@x.com", ownerIdentifier: null, source: null },
    ])
    expect(rows.map((r) => r.id)).toEqual(["b", "a"])
  })
})

describe("linkSourceBadgeVariant", () => {
  it.each([
    ["auto", "default"],
    ["manual", "primary"],
    ["revoked", "outline"],
  ] as const)("%s -> %s", (source, expected) => {
    expect(linkSourceBadgeVariant(source)).toBe(expected)
  })
})

describe("countMultiLinkUsers", () => {
  const row = (id: string, links: AdminUserRow["links"]): AdminUserRow => ({
    id, name: null, email: null, links,
  })

  it("counts users with two or more EFFECTIVE links", () => {
    expect(
      countMultiLinkUsers([
        row("a", [
          { ownerIdentifier: "o1", source: "auto" },
          { ownerIdentifier: "o2", source: "auto" },
        ]),
        row("b", [{ ownerIdentifier: "o1", source: "auto" }]),
        row("c", []),
      ])
    ).toBe(1)
  })

  it("does not count a revoked link toward the total", () => {
    expect(
      countMultiLinkUsers([
        row("a", [
          { ownerIdentifier: "o1", source: "auto" },
          { ownerIdentifier: "o2", source: "revoked" },
        ]),
      ])
    ).toBe(0)
  })
})

describe("addableOwners", () => {
  const all = [
    { ownerIdentifier: "o1", ownerName: "One" },
    { ownerIdentifier: "o2", ownerName: "Two" },
    { ownerIdentifier: "o3", ownerName: "Three" },
  ]

  it("excludes owners the user already effectively holds", () => {
    expect(
      addableOwners(all, [
        { ownerIdentifier: "o1", source: "auto" },
        { ownerIdentifier: "o2", source: "manual" },
      ]).map((o) => o.ownerIdentifier)
    ).toEqual(["o3"])
  })

  it("still offers an owner whose only link is revoked (re-linking is allowed)", () => {
    expect(
      addableOwners(all, [{ ownerIdentifier: "o1", source: "revoked" }]).map((o) => o.ownerIdentifier)
    ).toEqual(["o1", "o2", "o3"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/owner-directory/admin-view.test.ts`
Expected: FAIL — module `@/lib/owner-directory/admin-view` not found.

- [ ] **Step 3: Create the view-model module**

Create `src/lib/owner-directory/admin-view.ts`. No `server-only` marker — the client component imports it:

```ts
import type { OwnerLinkSource } from "@/db/schema"
import { isEffectiveLinkSource } from "./link"

export type AdminOwnerLink = {
  ownerIdentifier: string
  source: OwnerLinkSource
}

export type AdminUserRow = {
  id: string
  name: string | null
  email: string | null
  links: AdminOwnerLink[]
}

/** One row per (user, link) as the left join returns it; nulls when unlinked. */
export type FlatUserLinkRow = {
  id: string
  name: string | null
  email: string | null
  ownerIdentifier: string | null
  source: OwnerLinkSource | null
}

/**
 * Collapse a left-joined user/link result into one row per user. User order is
 * preserved from the query (which orders by email); links are sorted by
 * identifier so chip order does not shift between renders.
 */
export function groupUserLinkRows(rows: FlatUserLinkRow[]): AdminUserRow[] {
  const byUser = new Map<string, AdminUserRow>()
  for (const row of rows) {
    let user = byUser.get(row.id)
    if (!user) {
      user = { id: row.id, name: row.name, email: row.email, links: [] }
      byUser.set(row.id, user)
    }
    if (row.ownerIdentifier !== null && row.source !== null) {
      user.links.push({ ownerIdentifier: row.ownerIdentifier, source: row.source })
    }
  }
  for (const user of byUser.values()) {
    user.links.sort((a, b) => a.ownerIdentifier.localeCompare(b.ownerIdentifier))
  }
  return [...byUser.values()]
}

/** Badge variant per link state. Revoked reads as muted, not as an error. */
export function linkSourceBadgeVariant(
  source: OwnerLinkSource
): "default" | "primary" | "outline" {
  if (source === "manual") return "primary"
  if (source === "revoked") return "outline"
  return "default"
}

/** How many users hold two or more effective owner profiles. */
export function countMultiLinkUsers(rows: AdminUserRow[]): number {
  return rows.filter(
    (r) => r.links.filter((l) => isEffectiveLinkSource(l.source)).length >= 2
  ).length
}

/**
 * Owners the admin can still add for this user. A revoked owner stays
 * offered — re-linking one is a normal correction.
 */
export function addableOwners<T extends { ownerIdentifier: string }>(
  all: T[],
  links: AdminOwnerLink[]
): T[] {
  const held = new Set(
    links.filter((l) => isEffectiveLinkSource(l.source)).map((l) => l.ownerIdentifier)
  )
  return all.filter((o) => !held.has(o.ownerIdentifier))
}
```

- [ ] **Step 4: Rewrite `listUsersWithLinks`**

In `src/lib/owner-directory/data.ts`, replace `listUsersWithLinks` (lines 84-105) with:

```ts
/**
 * Admin-only: every user with all their owner links (including revoked ones,
 * which the panel shows so a suppression is never invisible).
 *
 * Deliberately does NOT join owner_locations for the display name: that table
 * has many rows per identifier, so the join would need a distinct/aggregate.
 * The admin component already receives the owner list from listLinkableOwners
 * and resolves names — and "not in the list" is exactly the orphaned-link case
 * it needs to surface.
 */
export async function listUsersWithLinks(): Promise<AdminUserRow[]> {
  await requireAdminSession()
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      ownerIdentifier: userOwnerLinks.ownerIdentifier,
      source: userOwnerLinks.source,
    })
    .from(users)
    .leftJoin(userOwnerLinks, eq(userOwnerLinks.userId, users.id))
    .orderBy(asc(users.email), asc(userOwnerLinks.ownerIdentifier))
  return groupUserLinkRows(rows)
}
```

Add to the imports at the top of `data.ts`:

```ts
import { userOwnerLinks } from "@/db/schema"
import { groupUserLinkRows, type AdminUserRow } from "./admin-view"
```

(Merge `userOwnerLinks` into the existing `@/db/schema` import line rather than adding a duplicate.)

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/__tests__/owner-directory/admin-view.test.ts`
Expected: all PASS.

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/components/admin/OwnerDirectory.tsx` (its `UserRow` type no longer matches) — Task 9 fixes it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/owner-directory/admin-view.ts src/lib/owner-directory/data.ts src/__tests__/owner-directory/admin-view.test.ts
git commit -m "feat(admin): pure view-model for multi-link owner rows"
```

---

### Task 9: Server actions per link

**Files:**
- Modify: `src/lib/owner-directory/actions.ts:26-92`
- Test: `src/__tests__/owner-directory/actions.test.ts` (create)

**Interfaces:**
- Consumes: `userOwnerLinks` (Task 1), `UNKNOWN_OWNER`, `requireAdmin` (`@/lib/auth-guards`).
- Produces, all returning `Promise<{ ok: true } | { ok: false; error: string }>`:
  - `addOwnerLink(userId: string, ownerIdentifier: string)`
  - `revokeOwnerLink(userId: string, ownerIdentifier: string)`
  - `clearOwnerLink(userId: string, ownerIdentifier: string)`

`manuallyLinkUser`, `manuallyUnlinkUser`, and `resetUserLink` are deleted. `refreshOwnerDirectory` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/owner-directory/actions.test.ts`. These cover the guards, which are the part worth protecting — a DB-level integration test is out of scope here. `builder` comes from the shared helper created in Task 3:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const requireAdmin = vi.fn()
vi.mock("@/lib/auth-guards", () => ({ requireAdmin }))

const select = vi.fn()
const insert = vi.fn()
const del = vi.fn()
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

vi.mock("@/lib/owner-directory/sync", () => ({ syncOwnerLocations: vi.fn() }))

describe("addOwnerLink", () => {
  beforeEach(() => {
    vi.resetModules()
    requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" })
    select.mockReset()
    insert.mockReset()
    del.mockReset()
  })

  it("refuses to assign the Unknown Owner bucket, without touching the DB", async () => {
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    const res = await addOwnerLink("user-1", "Unknown Owner")
    expect(res).toEqual({ ok: false, error: "Unknown Owner cannot be assigned to a user" })
    expect(select).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it("refuses an owner_identifier absent from the directory", async () => {
    select.mockReturnValue(builder([]))
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await addOwnerLink("user-1", "ghost-owner")).toEqual({
      ok: false,
      error: "Unknown owner_identifier: ghost-owner",
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it("upserts a manual link when the owner exists", async () => {
    select.mockReturnValue(builder([{ id: "ol-1" }]))
    insert.mockReturnValue(builder(undefined))
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await addOwnerLink("user-1", "ut-towns")).toEqual({ ok: true })
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("requires an admin", async () => {
    requireAdmin.mockRejectedValue(new Error("Admin access required"))
    const { addOwnerLink } = await import("@/lib/owner-directory/actions")
    await expect(addOwnerLink("user-1", "ut-towns")).rejects.toThrow("Admin access required")
  })
})

describe("revokeOwnerLink / clearOwnerLink", () => {
  beforeEach(() => {
    vi.resetModules()
    requireAdmin.mockReset().mockResolvedValue({ id: "admin-1", role: "admin" })
    select.mockReset()
    insert.mockReset()
    del.mockReset()
  })

  it("revokes WITHOUT requiring the owner to still be in the directory", async () => {
    insert.mockReturnValue(builder(undefined))
    const { revokeOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await revokeOwnerLink("user-1", "vanished-owner")).toEqual({ ok: true })
    expect(select).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it("clears a link by deleting the row", async () => {
    del.mockReturnValue(builder(undefined))
    const { clearOwnerLink } = await import("@/lib/owner-directory/actions")
    expect(await clearOwnerLink("user-1", "ut-towns")).toEqual({ ok: true })
    expect(del).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/owner-directory/actions.test.ts`
Expected: FAIL — `addOwnerLink`, `revokeOwnerLink`, `clearOwnerLink` are not exported.

- [ ] **Step 3: Rewrite the actions**

In `src/lib/owner-directory/actions.ts`, replace everything from line 26 to the end (keep `refreshOwnerDirectory` as-is), and update the imports:

```ts
"use server"

import { revalidatePath } from "next/cache"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { ownerLocations, userOwnerLinks } from "@/db/schema"
import { syncOwnerLocations, type SyncResult } from "./sync"
import { UNKNOWN_OWNER } from "./query"
import { requireAdmin } from "@/lib/auth-guards"

type ActionResult = { ok: true } | { ok: false; error: string }

// ... refreshOwnerDirectory unchanged ...

/**
 * Upsert a link row. One row per (user, owner) — so re-linking a previously
 * revoked owner flips the existing row instead of failing on the unique index
 * or duplicating it. Idempotent: a double-click is harmless.
 */
async function upsertLink(
  userId: string,
  ownerIdentifier: string,
  source: "manual" | "revoked",
  actorUserId: string | null
): Promise<void> {
  await db
    .insert(userOwnerLinks)
    .values({ userId, ownerIdentifier, source, actorUserId })
    .onConflictDoUpdate({
      target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
      set: { source, actorUserId, updatedAt: sql`now()` },
    })
}

/**
 * Admin manual override: link a user to an owner_identifier (source=manual).
 * Manual links are never overwritten or removed by the automatic email match.
 * The owner must exist in the directory and not be the Unknown Owner bucket.
 */
export async function addOwnerLink(
  userId: string,
  ownerIdentifier: string
): Promise<ActionResult> {
  const admin = await requireAdmin()
  if (ownerIdentifier === UNKNOWN_OWNER) {
    return { ok: false, error: "Unknown Owner cannot be assigned to a user" }
  }

  const exists = await db
    .select({ id: ownerLocations.id })
    .from(ownerLocations)
    .where(
      and(
        eq(ownerLocations.ownerIdentifier, ownerIdentifier),
        ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER)
      )
    )
    .limit(1)
  if (exists.length === 0) {
    return { ok: false, error: `Unknown owner_identifier: ${ownerIdentifier}` }
  }

  await upsertLink(userId, ownerIdentifier, "manual", admin.id ?? null)
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}

/**
 * Admin manual override: revoke one owner profile for a user. Durable — the
 * login matcher skips revoked owners, so this survives re-sync and re-login.
 *
 * Deliberately does NOT validate directory membership: revoking an orphaned
 * link (an identifier the sync has since dropped) is exactly the cleanup an
 * admin needs, and validating would block it.
 */
export async function revokeOwnerLink(
  userId: string,
  ownerIdentifier: string
): Promise<ActionResult> {
  const admin = await requireAdmin()
  await upsertLink(userId, ownerIdentifier, "revoked", admin.id ?? null)
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}

/**
 * Admin: delete a link row outright. Undoes a revocation (the owner becomes
 * eligible for automatic linking again on the user's next login) or removes a
 * manual link. Also does not validate directory membership.
 */
export async function clearOwnerLink(
  userId: string,
  ownerIdentifier: string
): Promise<ActionResult> {
  await requireAdmin()
  await db
    .delete(userOwnerLinks)
    .where(
      and(
        eq(userOwnerLinks.userId, userId),
        eq(userOwnerLinks.ownerIdentifier, ownerIdentifier)
      )
    )
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}
```

`requireAdmin()` (`src/lib/auth-guards.ts:31`) returns the NextAuth `Session["user"]`, whose `id` is optional (`id?: string`), which is why every call site above passes `admin.id ?? null` — `actor_user_id` is a nullable column, so a missing id records as null rather than failing the write.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/__tests__/owner-directory/actions.test.ts`
Expected: all PASS.

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/components/admin/OwnerDirectory.tsx` (still importing the deleted action names) — Task 10 fixes it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/owner-directory/actions.ts src/__tests__/owner-directory/actions.test.ts
git commit -m "feat(admin): per-link add/revoke/clear owner actions"
```

---

### Task 10: Admin UI chips

**Files:**
- Modify: `src/components/admin/OwnerDirectory.tsx` (imports, `UserRow` type, table header, `UserLinkRow`)
- Modify: `src/app/admin/owner-directory/page.tsx`

**Interfaces:**
- Consumes: `AdminUserRow`, `AdminOwnerLink`, `linkSourceBadgeVariant`, `addableOwners`, `countMultiLinkUsers` (Task 8); `addOwnerLink`, `revokeOwnerLink`, `clearOwnerLink` (Task 9).
- Produces: no new exports. `OwnerDirectory` gains a `multiLinkCount: number` prop.

There is no component test harness in this repo (see Task 8), so this task's gates are `tsc` plus the manual check in Step 5. Do not add `@testing-library/react` or switch the vitest environment.

- [ ] **Step 1: Update the imports and types**

In `src/components/admin/OwnerDirectory.tsx`, replace the action import (lines 7-12) with:

```ts
import {
  refreshOwnerDirectory,
  addOwnerLink,
  revokeOwnerLink,
  clearOwnerLink,
} from "@/lib/owner-directory/actions"
import {
  linkSourceBadgeVariant,
  addableOwners,
  type AdminUserRow,
  type AdminOwnerLink,
} from "@/lib/owner-directory/admin-view"
import { isEffectiveLinkSource } from "@/lib/owner-directory/link"
```

Delete the local `UserRow` type (lines 27-33) — `AdminUserRow` replaces it. Update the component's props signature (lines 44-52) to:

```ts
export function OwnerDirectory({
  directory,
  users,
  owners,
  multiLinkCount,
}: {
  directory: DirectoryRow[]
  users: AdminUserRow[]
  owners: Owner[]
  multiLinkCount: number
}) {
```

- [ ] **Step 2: Update the override panel header and table head**

Replace the panel's heading and description (lines 116-120) with:

```tsx
        <h2 className="text-lg font-semibold text-gray-900">Owner links</h2>
        <p className="text-sm text-gray-500">
          A user can hold several owner profiles — owners appear in the directory once per
          co-ownership grouping. Links are matched automatically from the directory contact
          email; add one by hand when a sign-in email differs. Manual links and revocations
          both survive re-sync.
          {multiLinkCount > 0 && (
            <>
              {" "}
              <span className="font-medium text-gray-700">
                {multiLinkCount} user{multiLinkCount !== 1 ? "s" : ""} linked to multiple owners.
              </span>
            </>
          )}
        </p>
```

Replace the four `<th>` cells (lines 125-128) with three:

```tsx
                <th className="text-left font-semibold px-4 py-2.5">User</th>
                <th className="text-left font-semibold px-4 py-2.5">Linked owners</th>
                <th className="text-left font-semibold px-4 py-2.5">Add</th>
```

- [ ] **Step 3: Rewrite `UserLinkRow`**

Replace the whole `UserLinkRow` function (lines 197-273) with:

```tsx
function UserLinkRow({
  user,
  owners,
  pending,
  run,
}: {
  user: AdminUserRow
  owners: Owner[]
  pending: boolean
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void
}) {
  const [selected, setSelected] = useState("")
  const inDirectory = useMemo(
    () => new Set(owners.map((o) => o.ownerIdentifier)),
    [owners]
  )
  const addable = useMemo(() => addableOwners(owners, user.links), [owners, user.links])

  return (
    <tr>
      <td className="px-4 py-2.5 align-top">
        <div className="font-medium text-gray-900">{user.name || "—"}</div>
        <div className="text-gray-500">{user.email}</div>
      </td>
      <td className="px-4 py-2.5 align-top">
        {user.links.length === 0 ? (
          <span className="text-gray-400">—</span>
        ) : (
          <div className="flex flex-col gap-1.5 items-start">
            {user.links.map((link) => (
              <LinkChip
                key={link.ownerIdentifier}
                link={link}
                userId={user.id}
                ownerName={owners.find((o) => o.ownerIdentifier === link.ownerIdentifier)?.ownerName ?? null}
                inDirectory={inDirectory.has(link.ownerIdentifier)}
                pending={pending}
                run={run}
              />
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 align-top">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm max-w-[14rem]"
          >
            <option value="">Select owner…</option>
            {addable.map((o) => (
              <option key={o.ownerIdentifier} value={o.ownerIdentifier}>
                {o.ownerIdentifier}
                {o.ownerName ? ` (${o.ownerName})` : ""}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !selected}
            onClick={() =>
              run(async () => {
                const res = await addOwnerLink(user.id, selected)
                if (res.ok) setSelected("")
                return res
              }, "Linked")
            }
          >
            Add
          </Button>
        </div>
      </td>
    </tr>
  )
}

/**
 * One owner link. Revoked links stay visible (muted, with an undo) so a
 * suppression is never invisible — otherwise a deliberately-blocked owner
 * looks like a bug months later.
 */
function LinkChip({
  link,
  userId,
  ownerName,
  inDirectory,
  pending,
  run,
}: {
  link: AdminOwnerLink
  userId: string
  ownerName: string | null
  inDirectory: boolean
  pending: boolean
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void
}) {
  const effective = isEffectiveLinkSource(link.source)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ${
        effective ? "border-gray-200 bg-white" : "border-dashed border-gray-300 bg-gray-50"
      }`}
    >
      <span className={effective ? "text-gray-900" : "text-gray-400 line-through"}>
        {link.ownerIdentifier}
      </span>
      {ownerName && <span className="text-xs text-gray-400">({ownerName})</span>}
      <Badge variant={linkSourceBadgeVariant(link.source)} size="sm">
        {link.source}
      </Badge>
      {!inDirectory && (
        <Badge variant="warning" size="sm">
          not in directory
        </Badge>
      )}
      {effective ? (
        <button
          type="button"
          aria-label={`Revoke ${link.ownerIdentifier}`}
          disabled={pending}
          onClick={() => run(() => revokeOwnerLink(userId, link.ownerIdentifier), "Revoked")}
          className="text-gray-400 hover:text-hs-red-600 disabled:opacity-40 px-0.5"
        >
          ×
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => clearOwnerLink(userId, link.ownerIdentifier), "Revocation cleared")}
          className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 underline"
        >
          undo
        </button>
      )}
    </span>
  )
}
```

- [ ] **Step 4: Pass the count from the page**

In `src/app/admin/owner-directory/page.tsx`, add the import:

```ts
import { countMultiLinkUsers } from "@/lib/owner-directory/admin-view"
```

and change the final return (line 30) to:

```tsx
  return (
    <OwnerDirectory
      directory={directory}
      users={users}
      owners={owners}
      multiLinkCount={countMultiLinkUsers(users)}
    />
  )
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: **no errors anywhere.**

Run: `npx vitest run`
Expected: all tests PASS.

Then read `src/components/admin/OwnerDirectory.tsx` end-to-end once and confirm by inspection: `useMemo` and `useState` are both imported (line 3 already imports both), no reference to `user.ownerIdentifier` or `user.ownerLinkSource` remains anywhere in the file, and no import of `manuallyLinkUser` / `manuallyUnlinkUser` / `resetUserLink` remains. Report that you did this — do not start a dev server to check.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/OwnerDirectory.tsx src/app/admin/owner-directory/page.tsx
git commit -m "feat(admin): render owner links as per-link chips with revoke/undo"
```

---

### Task 11: Backfill (pure mapping + script)

**Files:**
- Create: `src/lib/owner-directory/backfill.ts`
- Create: `scripts/backfill-user-owner-links.ts`
- Test: `src/__tests__/owner-directory/backfill.test.ts`

**Interfaces:**
- Consumes: `OwnerLinkSource` (Task 1).
- Produces:
  - `type LegacyLinkState = { userId: string; ownerIdentifier: string | null; ownerLinkSource: "auto" | "manual" | null; emailMatchedOwners: string[] }`
  - `type BackfillLinkRow = { userId: string; ownerIdentifier: string; source: OwnerLinkSource }`
  - `function planBackfillRows(state: LegacyLinkState): BackfillLinkRow[]`

The third case below is the one that matters: `manuallyUnlinkUser` wrote `ownerIdentifier: null, ownerLinkSource: "manual"`, which means "deliberately unlinked, do not re-link me" — not "no link". Dropping it would auto-link a deliberately-unlinked user on their next sign-in, silently reversing an admin decision.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/owner-directory/backfill.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { planBackfillRows } from "@/lib/owner-directory/backfill"

describe("planBackfillRows", () => {
  it("carries an auto link across as auto", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: "ut-towns",
        ownerLinkSource: "auto",
        emailMatchedOwners: ["ut-towns", "ut-lines-towns"],
      })
    ).toEqual([{ userId: "u1", ownerIdentifier: "ut-towns", source: "auto" }])
  })

  it("carries a manual link across as manual", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: "ut-lines-towns",
        ownerLinkSource: "manual",
        emailMatchedOwners: [],
      })
    ).toEqual([{ userId: "u1", ownerIdentifier: "ut-lines-towns", source: "manual" }])
  })

  it("treats a set identifier with a null source as auto rather than dropping it", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: "az-corp",
        ownerLinkSource: null,
        emailMatchedOwners: [],
      })
    ).toEqual([{ userId: "u1", ownerIdentifier: "az-corp", source: "auto" }])
  })

  it("converts a deliberate unlink into a revocation for EVERY matching owner", () => {
    // manuallyUnlinkUser wrote {ownerIdentifier: null, source: "manual"}. That
    // means "do not re-link me" — without revocations the next login would
    // auto-link them and reverse the admin's decision.
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: null,
        ownerLinkSource: "manual",
        emailMatchedOwners: ["ut-lines-towns", "ut-towns"],
      })
    ).toEqual([
      { userId: "u1", ownerIdentifier: "ut-lines-towns", source: "revoked" },
      { userId: "u1", ownerIdentifier: "ut-towns", source: "revoked" },
    ])
  })

  it("produces nothing for a deliberate unlink whose email matches nothing", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: null,
        ownerLinkSource: "manual",
        emailMatchedOwners: [],
      })
    ).toEqual([])
  })

  it("produces nothing for a plain never-linked user", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: null,
        ownerLinkSource: null,
        emailMatchedOwners: ["az-corp"],
      })
    ).toEqual([])
  })

  it("dedupes and sorts revocations", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: null,
        ownerLinkSource: "manual",
        emailMatchedOwners: ["z-owner", "a-owner", "z-owner"],
      }).map((r) => r.ownerIdentifier)
    ).toEqual(["a-owner", "z-owner"])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/owner-directory/backfill.test.ts`
Expected: FAIL — module `@/lib/owner-directory/backfill` not found.

- [ ] **Step 3: Write the pure mapping**

Create `src/lib/owner-directory/backfill.ts`:

```ts
import type { OwnerLinkSource } from "@/db/schema"

/**
 * A user's legacy link state, as the old scalar columns recorded it, plus the
 * owner profiles their normalized email matches today (Unknown Owner already
 * excluded by the caller).
 */
export type LegacyLinkState = {
  userId: string
  ownerIdentifier: string | null
  ownerLinkSource: "auto" | "manual" | null
  emailMatchedOwners: string[]
}

export type BackfillLinkRow = {
  userId: string
  ownerIdentifier: string
  source: OwnerLinkSource
}

/**
 * Map one user's legacy scalar state onto user_owner_links rows.
 *
 *   identifier + auto    -> one auto row
 *   identifier + manual  -> one manual row
 *   identifier + null    -> one auto row (shouldn't exist; better than
 *                           silently dropping a live link)
 *   null + manual        -> a REVOKED row per matching owner. This is the
 *                           "deliberately unlinked, don't re-link me" state
 *                           manuallyUnlinkUser wrote. Skipping it would let
 *                           the next login auto-link them and reverse an
 *                           admin decision.
 *   null + null          -> nothing (never linked)
 *
 * Pure, so this table is testable without a database.
 */
export function planBackfillRows(state: LegacyLinkState): BackfillLinkRow[] {
  if (state.ownerIdentifier) {
    return [
      {
        userId: state.userId,
        ownerIdentifier: state.ownerIdentifier,
        source: state.ownerLinkSource === "manual" ? "manual" : "auto",
      },
    ]
  }

  if (state.ownerLinkSource === "manual") {
    return [...new Set(state.emailMatchedOwners)]
      .sort((a, b) => a.localeCompare(b))
      .map((ownerIdentifier) => ({
        userId: state.userId,
        ownerIdentifier,
        source: "revoked" as const,
      }))
  }

  return []
}
```

- [ ] **Step 4: Write the script**

Create `scripts/backfill-user-owner-links.ts`, following the `scripts/geocode-owner-locations.ts` pattern (dotenv first, own drizzle client, `--dry-run` flag, idempotent):

```ts
/**
 * Backfill user_owner_links from the legacy users.owner_identifier /
 * users.owner_link_source scalars.
 *
 * Run:  npx tsx scripts/backfill-user-owner-links.ts --dry-run   (no writes)
 *       npx tsx scripts/backfill-user-owner-links.ts             (live)
 *
 * Requires DATABASE_URL in .env.local. Run AFTER applying
 * drizzle/0005_user_owner_links.sql.
 *
 * Safe to re-run: every write is an upsert keyed on (user_id, owner_identifier),
 * so an interrupted run can simply be run again.
 */
import { config } from "dotenv"
config({ path: ".env.local" })

import { drizzle } from "drizzle-orm/neon-http"
import { neon } from "@neondatabase/serverless"
import { and, eq, ne, sql } from "drizzle-orm"
import { users } from "../src/db/schema/auth"
import { ownerLocations } from "../src/db/schema/ownerLocations"
import { userOwnerLinks } from "../src/db/schema/userOwnerLinks"
import { planBackfillRows, type BackfillLinkRow } from "../src/lib/owner-directory/backfill"
import { normalizeEmail } from "../src/lib/owner-directory/email"

const UNKNOWN_OWNER = "Unknown Owner"
const DRY_RUN = process.argv.includes("--dry-run")

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
  const db = drizzle(neon(process.env.DATABASE_URL))

  const legacy = await db
    .select({
      id: users.id,
      email: users.email,
      ownerIdentifier: users.ownerIdentifier,
      ownerLinkSource: users.ownerLinkSource,
    })
    .from(users)

  // Only users in the "deliberately unlinked" state need the email match.
  const needMatch = legacy.filter((u) => !u.ownerIdentifier && u.ownerLinkSource === "manual")
  const matchesByUser = new Map<string, string[]>()
  for (const u of needMatch) {
    const normalized = normalizeEmail(u.email)
    if (!normalized) {
      matchesByUser.set(u.id, [])
      continue
    }
    const rows = await db
      .selectDistinct({ ownerIdentifier: ownerLocations.ownerIdentifier })
      .from(ownerLocations)
      .where(
        and(
          eq(ownerLocations.ownerContactEmailNormalized, normalized),
          ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER)
        )
      )
    matchesByUser.set(u.id, rows.map((r) => r.ownerIdentifier))
  }

  const planned: BackfillLinkRow[] = legacy.flatMap((u) =>
    planBackfillRows({
      userId: u.id,
      ownerIdentifier: u.ownerIdentifier,
      ownerLinkSource: u.ownerLinkSource,
      emailMatchedOwners: matchesByUser.get(u.id) ?? [],
    })
  )

  const counts = planned.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + 1
    return acc
  }, {})
  console.log(`${legacy.length} users -> ${planned.length} link rows`, counts)

  if (DRY_RUN) {
    for (const r of planned) console.log(`  ${r.userId} ${r.ownerIdentifier} ${r.source}`)
    console.log("dry run: no writes")
    process.exit(0)
  }

  for (const row of planned) {
    await db
      .insert(userOwnerLinks)
      .values(row)
      .onConflictDoUpdate({
        target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
        set: { source: row.source, updatedAt: sql`now()` },
      })
  }
  console.log(`wrote ${planned.length} rows`)
  process.exit(0)
}

main().catch((e) => {
  console.error("Backfill failed:", e)
  process.exit(1)
})
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/__tests__/owner-directory/backfill.test.ts`
Expected: all PASS.

Run: `npx tsc --noEmit`
Expected: no errors.

Do NOT execute the script. Applying the migration and running the backfill is the user's decision.

- [ ] **Step 6: Commit**

```bash
git add src/lib/owner-directory/backfill.ts scripts/backfill-user-owner-links.ts src/__tests__/owner-directory/backfill.test.ts
git commit -m "feat(owner-links): backfill script mapping legacy scalars to link rows"
```

---

### Task 12: Final verification and PR 1

**Files:** none modified.

- [ ] **Step 1: Full gates**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests PASS. Record the pass/fail counts.

- [ ] **Step 2: Confirm no legacy reads remain**

Run: `git grep -n "ownerLinkSource\|manuallyLinkUser\|manuallyUnlinkUser\|resetUserLink\|decideOwnerLink" -- src scripts`
Expected: matches ONLY in these four files, all intentional —
`src/db/schema/auth.ts` (the columns themselves, still present through PR 1),
`scripts/backfill-user-owner-links.ts`, `src/lib/owner-directory/backfill.ts`,
and `src/__tests__/owner-directory/backfill.test.ts` (the backfill reads the
legacy state on purpose). Any other match is an unmigrated call site — fix it.

Run: `git grep -n "user\.ownerIdentifier\|session\.user\.ownerIdentifier\b" -- src`
Expected: no matches.

- [ ] **Step 3: Report and stop**

Summarize for the user: tests passing, the two artifacts they must apply themselves (`npm run db:migrate`, then `npx tsx scripts/backfill-user-owner-links.ts --dry-run` before a live run), and that PR 2 is deliberately deferred.

Do NOT push or open a PR without explicit approval, and do NOT run the migration or backfill.

---

### Task 13: PR 2 — drop the legacy columns (DEFERRED)

**Do not start this task until the user confirms PR 1 is merged and verified in production.** Running it earlier breaks prod: the old deployment still reads `users.owner_identifier` until the new one is live.

**Files:**
- Modify: `src/db/schema/auth.ts:18-25`
- Create: `drizzle/0006_drop_users_owner_scalars.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0006_snapshot.json`
- Modify: `scripts/backfill-user-owner-links.ts` (delete — its inputs no longer exist)

- [ ] **Step 1: Remove the columns from the schema**

In `src/db/schema/auth.ts`, delete lines 18-22 (the comment, `ownerIdentifier`, and `ownerLinkSource`) and the `users_owner_identifier_idx` index (line 24), leaving:

```ts
export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  // Custom columns:
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  sellerAccess: boolean("seller_access").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Login analytics (denormalized; login_events is source of truth)
  loginCount: integer("login_count").default(0).notNull(),
  lastLoginAt: timestamp("last_login_at"),
})
```

Note the table callback (the second argument) goes away entirely, since that index was its only entry. Remove the now-unused `index` import if `tsc` flags it.

- [ ] **Step 2: Author the migration**

Create `drizzle/0006_drop_users_owner_scalars.sql`:

```sql
DROP INDEX IF EXISTS "users_owner_identifier_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "owner_identifier";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "owner_link_source";
```

`IF EXISTS` throughout: these objects were pushed, never recorded in a snapshot, so their presence cannot be assumed from the migration history.

Append to `drizzle/meta/_journal.json`:

```json
    {
      "idx": 6,
      "version": "7",
      "when": 1785240000000,
      "tag": "0006_drop_users_owner_scalars",
      "breakpoints": true
    }
```

Create `drizzle/meta/0006_snapshot.json` as a copy of `0005_snapshot.json` with a fresh `id` (generate one with `node -e "console.log(require('crypto').randomUUID())"`) and `prevId` set to `0005`'s `id` (`e7ce99ee-3f3d-4ceb-9f27-a32463a750fd`). The `public.users` table entry needs **no** edit — `0004_snapshot.json` never recorded these columns, so there is nothing to remove.

- [ ] **Step 3: Delete the spent backfill script**

```bash
git rm scripts/backfill-user-owner-links.ts src/lib/owner-directory/backfill.ts src/__tests__/owner-directory/backfill.test.ts
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all PASS, including `migration-artifacts.test.ts` (the `0006` chain must satisfy it).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/auth.ts drizzle/0006_drop_users_owner_scalars.sql drizzle/meta/_journal.json drizzle/meta/0006_snapshot.json
git commit -m "refactor(db): drop legacy users.owner_identifier scalars"
```
