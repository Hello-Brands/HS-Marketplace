# Admin MCP Server — PR A: Core Extraction + Audit Log + Activity Feed

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift every admin mutation out of `"use server"` files into plain, actor-first core functions that write an audit row, and ship an admin activity feed on top, so the MCP server (PR C) and the web UI share one code path.

**Architecture:** New `src/lib/admin/core/*` modules hold today's admin logic unchanged except for an `AdminActor` first argument and a `withAudit(...)` wrapper. The existing server actions become one-line wrappers (`requireAdmin()` → build actor → call core), so no client component changes. A new `admin_audit_log` table records every mutation; `src/lib/admin/activity.ts` unions it with existing timestamps into a feed rendered at `/admin/activity`.

**Tech Stack:** Next.js 15 App Router (modified — mirror sibling routes), Drizzle ORM on Neon HTTP (no transactions; `db.batch`), Auth.js v5 DB sessions, zod 4, vitest (node env), `@sentry/nextjs`.

**Spec:** `docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md` (sections 5, 6, 8, 9)

## Global Constraints

- Migrations are hand-authored SQL. This PR adds **`drizzle/0011_admin_audit_log.sql`** and a journal entry with `idx: 11`. Never run `db:push` against a shared DB.
- New shared modules are **not** `"use server"` and carry the "NOT a use server module" header (copy the wording from `src/lib/alerts/matching.ts:1-15`).
- Every export of a `"use server"` file must still begin with `await requireAdmin()` (from `@/lib/auth-guards`).
- Exported server-action names and parameter lists stay **identical** (UI callers: `src/components/admin/UsersManager.tsx`, `OwnerDirectory.tsx`, `DataMappings.tsx`, `ModerationQueue.tsx`, `BrandRequestActions.tsx`). Return values may gain an `auditId` field.
- Error convention is unchanged: listing/user/brand-request actions **throw** `Error(message)`; `addToAllowlist`, `addOwnerLink`, `revokeOwnerLink`, `clearOwnerLink`, `refreshOwnerDirectory`, `setLocationMapping` **return** `{ ok: false, error }`.
- Path alias `@/*` → `src/*`. Tests live in `src/__tests__/**/*.test.ts`, node env; `test/helpers/drizzle-mock.ts` exports `builder(result)`.
- Gates before every commit that touches TS: `npx tsc --noEmit`, `npx eslint .`, `npm test` (or the single test file while iterating). Do not start `npm run dev`; do not run `next build` while a dev server is running.
- Commit messages: conventional commits, body ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Audit action names (use exactly these strings): `listing.approve`, `listing.reject`, `listing.update`, `listing.mark_sold`, `user.set_role`, `user.set_seller_access`, `user.remove`, `allowlist.add`, `allowlist.remove`, `brand_request.approve`, `brand_request.reject`, `brand_request.retry_dispatch`, `owner_link.add`, `owner_link.revoke`, `owner_link.clear`, `owner_directory.refresh`, `listing_location.set_data_mapping`, `mcp_token.revoke` (PR B), `mcp.read` (PR C).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/db/schema/adminAuditLog.ts` (create) | Drizzle table `admin_audit_log` + types |
| `drizzle/0011_admin_audit_log.sql`, `drizzle/meta/_journal.json` (create/modify) | Migration |
| `src/db/schema.ts` (modify) | Barrel export |
| `src/lib/admin/core/actor.ts` (create) | `AdminActor` type, `uiActor`, `uiActorFromSession` |
| `src/lib/admin/audit.ts` (create) | `withAudit`, `recordMcpRead`, `redactAuditArgs` |
| `src/lib/admin/core/listings.ts` (create) | listing moderation core |
| `src/lib/admin/actions.ts` (modify) | thin wrappers |
| `src/lib/admin/core/users.ts`, `core/allowlist.ts` (create) | user/allowlist core |
| `src/app/admin/users/actions.ts` (modify) | thin wrappers |
| `src/lib/admin/core/brand-requests.ts` (create) | brand-request admin core |
| `src/lib/brand-requests/actions.ts` (modify) | thin wrappers (submitBrandRequest untouched) |
| `src/lib/admin/core/owner-links.ts`, `core/owner-directory.ts` (create) | owner link / sync core |
| `src/lib/owner-directory/actions.ts` (modify) | thin wrappers |
| `src/lib/admin/core/data-mappings.ts` (create) | data-mapping core |
| `src/lib/data/mapping-actions.ts` (modify) | thin wrapper, now `requireAdmin()` |
| `src/lib/admin/core/inquiries.ts`, `core/analytics.ts` (create) | admin read queries |
| `src/app/admin/inquiries/actions.ts`, `src/app/admin/analytics/actions.ts` (modify) | thin wrappers |
| `src/lib/admin/activity.ts` (create) | union feed query, cursor, summaries |
| `src/app/admin/activity/page.tsx` (create) | feed page |
| `src/lib/navigation.ts` (modify) | nav entry |
| Tests under `src/__tests__/admin/` (create) and existing action tests (modify) | |

---

### Task 1: `admin_audit_log` schema, migration, barrel

**Files:**
- Create: `src/db/schema/adminAuditLog.ts`
- Create: `drizzle/0011_admin_audit_log.sql`
- Modify: `drizzle/meta/_journal.json` (append entry after idx 10)
- Modify: `src/db/schema.ts` (add export)
- Test: `src/__tests__/admin/audit-schema.test.ts`

**Interfaces:**
- Produces: `adminAuditLog` table; `AUDIT_SOURCES`, `AUDIT_OUTCOMES`, `AUDIT_TARGET_TYPES` const tuples; types `AdminAuditLogRow`, `NewAdminAuditLogRow`, `AuditSource`, `AuditOutcome`, `AuditTargetType`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/admin/audit-schema.test.ts
import { describe, it, expect } from "vitest"
import { getTableColumns, getTableName } from "drizzle-orm"
import { adminAuditLog, AUDIT_TARGET_TYPES } from "@/db/schema/adminAuditLog"

describe("admin_audit_log schema", () => {
  it("is named admin_audit_log with the spec'd columns", () => {
    expect(getTableName(adminAuditLog)).toBe("admin_audit_log")
    expect(Object.keys(getTableColumns(adminAuditLog)).sort()).toEqual(
      [
        "action",
        "actorUserId",
        "args",
        "createdAt",
        "durationMs",
        "error",
        "id",
        "mcpClientId",
        "mcpTokenId",
        "outcome",
        "source",
        "targetId",
        "targetType",
      ].sort(),
    )
  })

  it("exports the target types the core modules will use", () => {
    expect(AUDIT_TARGET_TYPES).toEqual([
      "listing",
      "user",
      "allowlist",
      "brand_request",
      "owner_link",
      "listing_location",
      "owner_directory",
      "mcp_token",
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/admin/audit-schema.test.ts`
Expected: FAIL — cannot resolve `@/db/schema/adminAuditLog`.

- [ ] **Step 3: Create the schema file**

```ts
// src/db/schema/adminAuditLog.ts
import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

/**
 * One row per admin mutation, whether it came from the web UI or the MCP
 * server. Written by `withAudit` in src/lib/admin/audit.ts — never insert
 * into this table directly. Reads are audited only when they come through
 * the MCP (`action = 'mcp.read'`).
 */
export const AUDIT_SOURCES = ["ui", "mcp"] as const
export type AuditSource = (typeof AUDIT_SOURCES)[number]

export const AUDIT_OUTCOMES = ["ok", "error"] as const
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

export const AUDIT_TARGET_TYPES = [
  "listing",
  "user",
  "allowlist",
  "brand_request",
  "owner_link",
  "listing_location",
  "owner_directory",
  "mcp_token",
] as const
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number]

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // Null after the acting admin is deleted; the row itself is kept.
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source", { enum: AUDIT_SOURCES }).notNull(),
    mcpClientId: text("mcp_client_id"),
    mcpTokenId: text("mcp_token_id"),
    // Dotted verb, e.g. "listing.approve". See the Global Constraints list in
    // the PR A plan for the full set.
    action: text("action").notNull(),
    targetType: text("target_type", { enum: AUDIT_TARGET_TYPES }),
    targetId: text("target_id"),
    // Redacted by redactAuditArgs before insert.
    args: jsonb("args").$type<unknown>(),
    outcome: text("outcome", { enum: AUDIT_OUTCOMES }).notNull(),
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("admin_audit_log_created_at_idx").on(table.createdAt.desc()),
    index("admin_audit_log_target_idx").on(table.targetType, table.targetId),
    index("admin_audit_log_actor_created_at_idx").on(table.actorUserId, table.createdAt.desc()),
  ],
)

export const adminAuditLogRelations = relations(adminAuditLog, ({ one }) => ({
  actor: one(users, { fields: [adminAuditLog.actorUserId], references: [users.id] }),
}))

export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect
export type NewAdminAuditLogRow = typeof adminAuditLog.$inferInsert
```

- [ ] **Step 4: Write the migration SQL**

```sql
-- drizzle/0011_admin_audit_log.sql
CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"source" text NOT NULL,
	"mcp_client_id" text,
	"mcp_token_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"args" jsonb,
	"outcome" text NOT NULL,
	"error" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_created_at_idx" ON "admin_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_target_idx" ON "admin_audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_audit_log_actor_created_at_idx" ON "admin_audit_log" USING btree ("actor_user_id","created_at" DESC NULLS LAST);
```

- [ ] **Step 5: Append the journal entry**

In `drizzle/meta/_journal.json`, after the `idx: 10` entry (add a comma to it), append:

```json
    {
      "idx": 11,
      "version": "7",
      "when": 1789344000000,
      "tag": "0011_admin_audit_log",
      "breakpoints": true
    }
```

Verify with: `node -e "const j=require('./drizzle/meta/_journal.json');console.log(j.entries.at(-1))"` → prints the idx 11 entry.

- [ ] **Step 5b: Hand-build the snapshot**

`src/__tests__/db/migration-artifacts.test.ts` requires `drizzle/meta/0011_snapshot.json` with `prevId` equal to `0010_snapshot.json`'s `id`. Copy 0010, set a fresh `id`, set `prevId` to 0010's id, and add the `public.admin_audit_log` table entry mirroring the SQL (see `.superpowers/sdd/.../task-1b-brief.md` for the generator script). Run `npx vitest run src/__tests__/db/migration-artifacts.test.ts` → 4/4.

- [ ] **Step 6: Export from the schema barrel**

Append to `src/db/schema.ts` after the `disclaimerAcknowledgments` line:

```ts
// Admin action audit log (written only via src/lib/admin/audit.ts)
export * from "./schema/adminAuditLog"
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/__tests__/admin/audit-schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/db/schema/adminAuditLog.ts drizzle/0011_admin_audit_log.sql drizzle/meta/_journal.json src/db/schema.ts src/__tests__/admin/audit-schema.test.ts
git commit -m "feat(audit): admin_audit_log table + migration 0011

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `AdminActor` and the audit writer

**Files:**
- Create: `src/lib/admin/core/actor.ts`
- Create: `src/lib/admin/audit.ts`
- Test: `src/__tests__/admin/actor.test.ts`
- Test: `src/__tests__/admin/audit.test.ts`

**Interfaces:**
- Consumes: `adminAuditLog` (Task 1).
- Produces:
  ```ts
  // src/lib/admin/core/actor.ts
  export interface AdminActor { userId: string; source: "ui" | "mcp"; clientId?: string; tokenId?: string }
  export function uiActor(userId: string): AdminActor
  export function uiActorFromSession(user: { id?: string | null }): AdminActor   // throws Error("Unauthorized") when id missing
  // src/lib/admin/audit.ts
  export interface AuditTarget { type: AuditTargetType; id: string | null }
  export function redactAuditArgs(args: unknown): unknown
  export function withAudit<T>(actor: AdminActor, action: string, target: AuditTarget | null, args: unknown, fn: () => Promise<T>): Promise<{ result: T; auditId: string }>
  export function recordMcpRead(actor: AdminActor, tool: string, args: unknown): Promise<string>
  ```

- [ ] **Step 1: Write the failing actor test**

```ts
// src/__tests__/admin/actor.test.ts
import { describe, it, expect } from "vitest"
import { uiActor, uiActorFromSession } from "@/lib/admin/core/actor"

describe("AdminActor helpers", () => {
  it("uiActor builds a ui-source actor", () => {
    expect(uiActor("u1")).toEqual({ userId: "u1", source: "ui" })
  })

  it("uiActorFromSession uses the session user id", () => {
    expect(uiActorFromSession({ id: "u2" })).toEqual({ userId: "u2", source: "ui" })
  })

  it("uiActorFromSession throws when the session has no id", () => {
    expect(() => uiActorFromSession({})).toThrow("Unauthorized")
    expect(() => uiActorFromSession({ id: null })).toThrow("Unauthorized")
  })
})
```

- [ ] **Step 2: Write the failing audit test**

```ts
// src/__tests__/admin/audit.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

const { insert, captureException } = vi.hoisted(() => ({
  insert: vi.fn(),
  captureException: vi.fn(),
}))
vi.mock("@/db", () => ({ db: { insert: (...a: unknown[]) => insert(...a) } }))
vi.mock("@sentry/nextjs", () => ({ captureException }))

import { withAudit, recordMcpRead, redactAuditArgs } from "@/lib/admin/audit"
import { adminAuditLog } from "@/db/schema/adminAuditLog"

const actor = { userId: "admin-1", source: "ui" as const }

describe("redactAuditArgs", () => {
  it("replaces message/notes/body keys and truncates long strings", () => {
    const long = "x".repeat(3000)
    expect(
      redactAuditArgs({ id: "l1", message: "hi", nested: { notes: "n", body: "b", keep: long } }),
    ).toEqual({
      id: "l1",
      message: "[redacted]",
      nested: { notes: "[redacted]", body: "[redacted]", keep: "x".repeat(2048) + "…[truncated]" },
    })
  })

  it("passes primitives and arrays through", () => {
    expect(redactAuditArgs(["a", 1, null])).toEqual(["a", 1, null])
    expect(redactAuditArgs(undefined)).toBeUndefined()
  })
})

describe("withAudit", () => {
  let insertBuilder: ChainedBuilder
  beforeEach(() => {
    insert.mockReset()
    captureException.mockReset()
    insertBuilder = builder(undefined)
    insert.mockReturnValue(insertBuilder)
  })

  it("records an ok row and returns the result + auditId", async () => {
    const out = await withAudit(actor, "listing.approve", { type: "listing", id: "l1" }, { listingId: "l1" }, async () => ({ success: true }))
    expect(out.result).toEqual({ success: true })
    expect(typeof out.auditId).toBe("string")
    expect(insert).toHaveBeenCalledWith(adminAuditLog)
    expect(insertBuilder.calls.values[0][0]).toMatchObject({
      id: out.auditId,
      actorUserId: "admin-1",
      source: "ui",
      action: "listing.approve",
      targetType: "listing",
      targetId: "l1",
      args: { listingId: "l1" },
      outcome: "ok",
      error: null,
    })
  })

  it("records an error row and rethrows when fn throws", async () => {
    await expect(
      withAudit(actor, "user.remove", { type: "user", id: "u9" }, {}, async () => {
        throw new Error("Cannot remove the last admin")
      }),
    ).rejects.toThrow("Cannot remove the last admin")
    expect(insertBuilder.calls.values[0][0]).toMatchObject({
      outcome: "error",
      error: "Cannot remove the last admin",
    })
  })

  it("treats an { ok:false, error } result as an error outcome without throwing", async () => {
    const out = await withAudit(actor, "allowlist.add", { type: "allowlist", id: null }, { raw: "x" }, async () => ({ ok: false as const, error: "Invalid" }))
    expect(out.result).toEqual({ ok: false, error: "Invalid" })
    expect(insertBuilder.calls.values[0][0]).toMatchObject({ outcome: "error", error: "Invalid" })
  })

  it("never lets an audit insert failure break the action", async () => {
    insert.mockImplementation(() => {
      throw new Error("db down")
    })
    const out = await withAudit(actor, "listing.approve", null, {}, async () => "done")
    expect(out.result).toBe("done")
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it("carries mcp client/token ids", async () => {
    await withAudit({ userId: "a", source: "mcp", clientId: "claude-code", tokenId: "t1" }, "listing.approve", null, {}, async () => 1)
    expect(insertBuilder.calls.values[0][0]).toMatchObject({ source: "mcp", mcpClientId: "claude-code", mcpTokenId: "t1" })
  })
})

describe("recordMcpRead", () => {
  it("writes an mcp.read row with the tool and filters", async () => {
    const b = builder(undefined)
    insert.mockReset().mockReturnValue(b)
    const id = await recordMcpRead({ userId: "a", source: "mcp", clientId: "c", tokenId: "t" }, "list_listings", { status: "pending" })
    expect(typeof id).toBe("string")
    expect(b.calls.values[0][0]).toMatchObject({
      action: "mcp.read",
      source: "mcp",
      args: { tool: "list_listings", filters: { status: "pending" } },
      outcome: "ok",
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/admin/actor.test.ts src/__tests__/admin/audit.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Create `actor.ts`**

```ts
// src/lib/admin/core/actor.ts
/**
 * Who is performing an admin mutation, and through which surface.
 *
 * This module is deliberately NOT a `"use server"` file — see
 * src/lib/alerts/matching.ts for why. Server actions build an actor from the
 * session; the MCP server builds one from a verified bearer token.
 */
export type AdminActorSource = "ui" | "mcp"

export interface AdminActor {
  userId: string
  source: AdminActorSource
  /** MCP only: the OAuth client that made the call. */
  clientId?: string
  /** MCP only: the grant (token row) that made the call. */
  tokenId?: string
}

export function uiActor(userId: string): AdminActor {
  return { userId, source: "ui" }
}

/** Build a UI actor from an Auth.js session user; the id is optional in the type. */
export function uiActorFromSession(user: { id?: string | null }): AdminActor {
  if (!user.id) throw new Error("Unauthorized")
  return uiActor(user.id)
}
```

- [ ] **Step 5: Create `audit.ts`**

```ts
// src/lib/admin/audit.ts
/**
 * Admin action audit log writer.
 *
 * This module is deliberately NOT a `"use server"` file. Every export of a
 * `"use server"` module is reachable as an unauthenticated POST endpoint, and
 * this module writes rows that the activity feed and MCP treat as truth. It is
 * only ever called server-side from the core admin modules. Do not re-export
 * it from a `"use server"` module and do not add `"use server"` here.
 */
import * as Sentry from "@sentry/nextjs"
import { db } from "@/db"
import { adminAuditLog, type AuditTargetType, type NewAdminAuditLogRow } from "@/db/schema/adminAuditLog"
import type { AdminActor } from "./core/actor"

export interface AuditTarget {
  type: AuditTargetType
  id: string | null
}

const REDACT_KEYS = new Set(["message", "notes", "body"])
const MAX_STRING = 2048

/** Strip free-text fields and cap long strings before the args hit the DB. */
export function redactAuditArgs(args: unknown): unknown {
  if (args === null || args === undefined) return args
  if (typeof args === "string") {
    return args.length > MAX_STRING ? `${args.slice(0, MAX_STRING)}…[truncated]` : args
  }
  if (Array.isArray(args)) return args.map(redactAuditArgs)
  if (typeof args === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k) ? "[redacted]" : redactAuditArgs(v)
    }
    return out
  }
  return args
}

function isRejectedResult(value: unknown): value is { ok: false; error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === "string"
  )
}

async function insertRow(row: NewAdminAuditLogRow): Promise<void> {
  try {
    await db.insert(adminAuditLog).values(row)
  } catch (err) {
    // Auditing must never block or fail the action it describes.
    console.error("[audit] failed to write admin_audit_log row", row.action, err)
    Sentry.captureException(err)
  }
}

function baseRow(actor: AdminActor, action: string, target: AuditTarget | null, args: unknown) {
  return {
    actorUserId: actor.userId,
    source: actor.source,
    mcpClientId: actor.clientId ?? null,
    mcpTokenId: actor.tokenId ?? null,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    args: redactAuditArgs(args),
  }
}

/**
 * Run `fn`, then write one audit row describing it. A thrown error is logged
 * as outcome "error" and rethrown. A returned `{ ok:false, error }` is logged
 * as outcome "error" but returned normally (that is the house convention for
 * user-input failures).
 */
export async function withAudit<T>(
  actor: AdminActor,
  action: string,
  target: AuditTarget | null,
  args: unknown,
  fn: () => Promise<T>,
): Promise<{ result: T; auditId: string }> {
  const auditId = crypto.randomUUID()
  const started = Date.now()
  const base = baseRow(actor, action, target, args)
  try {
    const result = await fn()
    const rejected = isRejectedResult(result)
    await insertRow({
      id: auditId,
      ...base,
      outcome: rejected ? "error" : "ok",
      error: rejected ? result.error : null,
      durationMs: Date.now() - started,
    })
    return { result, auditId }
  } catch (err) {
    await insertRow({
      id: auditId,
      ...base,
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    })
    throw err
  }
}

/** Lighter row for MCP read tools so an AI session's reads are visible. */
export async function recordMcpRead(actor: AdminActor, tool: string, args: unknown): Promise<string> {
  const auditId = crypto.randomUUID()
  await insertRow({
    id: auditId,
    ...baseRow(actor, "mcp.read", null, { tool, filters: args }),
    outcome: "ok",
    error: null,
    durationMs: 0,
  })
  return auditId
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/admin/actor.test.ts src/__tests__/admin/audit.test.ts`
Expected: PASS (3 + 7 tests).

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit
git add src/lib/admin/core/actor.ts src/lib/admin/audit.ts src/__tests__/admin/actor.test.ts src/__tests__/admin/audit.test.ts
git commit -m "feat(audit): AdminActor and withAudit writer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Extract listing moderation core

**Files:**
- Create: `src/lib/admin/core/listings.ts`
- Modify: `src/lib/admin/actions.ts` (replace bodies with wrappers)
- Modify: `src/__tests__/listings/write-path-guards.test.ts`, `src/__tests__/listings/admin-edit-parity.test.ts`, `src/__tests__/analytics/listed-at-wiring.test.ts` (add audit mock)
- Test: `src/__tests__/admin/core-listings.test.ts`

**Interfaces:**
- Consumes: `AdminActor`, `withAudit`.
- Produces (in `@/lib/admin/core/listings`):
  ```ts
  export function getPendingListings()
  export function getAllListings(statusFilter?: ListingStatus)
  export function approveListing(actor: AdminActor, listingId: string): Promise<{ success: true; auditId: string }>
  export function rejectListing(actor: AdminActor, listingId: string, reason: string, notes?: string): Promise<{ success: true; auditId: string }>
  export function adminUpdateListing(actor: AdminActor, listingId: string, input: Partial<ListingFormData>): Promise<{ success: true; auditId: string }>
  export function adminMarkSold(actor: AdminActor, listingId: string): Promise<{ success: true; auditId: string }>
  ```

- [ ] **Step 1: Add the audit pass-through mock to the three existing tests**

In each of `src/__tests__/listings/write-path-guards.test.ts`, `src/__tests__/listings/admin-edit-parity.test.ts`, `src/__tests__/analytics/listed-at-wiring.test.ts`, directly after the existing `vi.mock("next/cache", ...)` line (match the file's quote style), add:

```ts
vi.mock("@/lib/admin/audit", () => ({
  withAudit: async (
    _actor: unknown,
    _action: unknown,
    _target: unknown,
    _args: unknown,
    fn: () => Promise<unknown>,
  ) => ({ result: await fn(), auditId: "audit-test" }),
  recordMcpRead: async () => "audit-test",
}))
```

Run: `npx vitest run src/__tests__/listings src/__tests__/analytics` → still PASS (mocking a module that isn't imported yet is harmless).

- [ ] **Step 2: Write the failing core test**

```ts
// src/__tests__/admin/core-listings.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { findFirst, update, updateSetCalls, withAudit } = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = []
  return {
    findFirst: vi.fn(),
    updateSetCalls,
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    withAudit: vi.fn(
      async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, fn: () => Promise<unknown>) => ({
        result: await fn(),
        auditId: "audit-1",
      }),
    ),
  }
})

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/lib/email", () => ({ sendStatusChangeEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/alerts/matching", () => ({ triggerAlertMatching: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/db", () => ({
  db: {
    update: update,
    query: { listings: { findFirst } },
  },
}))

import { adminMarkSold } from "@/lib/admin/core/listings"

const actor = { userId: "admin-1", source: "ui" as const }

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
})

describe("core adminMarkSold", () => {
  it("throws when the listing is missing (no audit-free path)", async () => {
    findFirst.mockResolvedValue(undefined)
    await expect(adminMarkSold(actor, "nope")).rejects.toThrow("Listing not found")
    expect(withAudit).toHaveBeenCalledWith(actor, "listing.mark_sold", { type: "listing", id: "nope" }, { listingId: "nope" }, expect.any(Function))
  })

  it("marks an active listing sold and returns the audit id", async () => {
    findFirst.mockResolvedValue({ id: "l1", status: "active" })
    const out = await adminMarkSold(actor, "l1")
    expect(out).toEqual({ success: true, auditId: "audit-1" })
    expect(updateSetCalls[0]).toMatchObject({ status: "sold" })
  })

  it("refuses an illegal transition", async () => {
    findFirst.mockResolvedValue({ id: "l1", status: "draft" })
    await expect(adminMarkSold(actor, "l1")).rejects.toThrow(/Cannot mark listing as sold/)
    expect(update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/admin/core-listings.test.ts`
Expected: FAIL — module `@/lib/admin/core/listings` not found.

- [ ] **Step 4: Create the core module**

```ts
// src/lib/admin/core/listings.ts
/**
 * Listing moderation core — shared by the admin server actions
 * (src/lib/admin/actions.ts) and the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. Every export of a
 * `"use server"` module is reachable as an unauthenticated POST endpoint; these
 * functions take a trusted `AdminActor` and do NOT check auth themselves. Do
 * not re-export them from a `"use server"` module and do not add `"use server"`
 * to this file.
 */
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq, desc } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { revalidatePath } from 'next/cache'
import { sendStatusChangeEmail } from '@/lib/email'
import { canTransition } from '@/lib/listings/status-machine'
import { nextListedAt } from '@/lib/analytics/helpers'
import { unresolvedSalonLocations } from '@/lib/data/mapping'
import { triggerAlertMatching } from '@/lib/alerts/matching'
import { buildListingUpdate } from '@/lib/listings/build-update'
import { parseListingPatch } from '@/lib/listings/schemas'
import { buildLocationSync, buildPhotoSync } from '@/lib/listings/persist'
import type { ListingStatus, ListingFormData } from '@/lib/listings/types'
import { withAudit } from '@/lib/admin/audit'
import type { AdminActor } from './actor'

export async function getPendingListings() {
  return db.query.listings.findMany({
    where: eq(listings.status, 'pending'),
    orderBy: [desc(listings.createdAt)],
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder], limit: 1 },
      seller: true,
    },
  })
}

export async function getAllListings(statusFilter?: ListingStatus) {
  const conditions = statusFilter ? eq(listings.status, statusFilter) : undefined
  return db.query.listings.findMany({
    where: conditions,
    orderBy: [desc(listings.createdAt)],
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder], limit: 1 },
      seller: true,
    },
  })
}

function revalidateListing(listingId: string) {
  revalidatePath('/admin/queue')
  revalidatePath('/admin/listings')
  revalidatePath(`/seller/listings/${listingId}`)
}

export async function approveListing(actor: AdminActor, listingId: string) {
  const { result, auditId } = await withAudit(
    actor,
    'listing.approve',
    { type: 'listing', id: listingId },
    { listingId },
    async () => {
      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, listingId),
        with: { seller: true },
      })

      if (!listing) throw new Error('Listing not found')

      if (!canTransition(listing.status as ListingStatus, 'active', 'admin')) {
        throw new Error(`Cannot approve listing with status ${listing.status}`)
      }

      // A listing cannot go active until every salon location's data-source mapping
      // is resolved (confirmed or explicitly not_connected). Wrong/blank mappings
      // would leak the wrong location's financials.
      const mapLocs = await db
        .select({
          id: listingLocations.id,
          name: listingLocations.name,
          locationType: listingLocations.locationType,
          dataMappingStatus: listingLocations.dataMappingStatus,
        })
        .from(listingLocations)
        .where(eq(listingLocations.listingId, listingId))
      const blocking = unresolvedSalonLocations(mapLocs)
      if (blocking.length > 0) {
        throw new Error(`Confirm data mapping for: ${blocking.map((b) => b.name).join(", ")}`)
      }

      await db.update(listings)
        .set({
          status: 'active',
          listedAt: nextListedAt(listing.listedAt ?? null, 'active', new Date()),
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(listings.id, listingId))

      if (listing.seller?.email) {
        await sendStatusChangeEmail({
          recipientEmail: listing.seller.email,
          recipientName: listing.seller.name || 'Seller',
          listingTitle: listing.title || 'Your listing',
          listingId: listing.id,
          newStatus: 'active',
        })
      }

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
        inventoryIncluded: listing.inventoryIncluded,
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

      revalidateListing(listingId)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}

export async function rejectListing(actor: AdminActor, listingId: string, reason: string, notes?: string) {
  const { result, auditId } = await withAudit(
    actor,
    'listing.reject',
    { type: 'listing', id: listingId },
    { listingId, reason, notes },
    async () => {
      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, listingId),
        with: { seller: true },
      })

      if (!listing) throw new Error('Listing not found')

      if (!canTransition(listing.status as ListingStatus, 'rejected', 'admin')) {
        throw new Error(`Cannot reject listing with status ${listing.status}`)
      }

      const fullReason = notes ? `${reason}: ${notes}` : reason

      await db.update(listings)
        .set({
          status: 'rejected',
          rejectionReason: fullReason,
          updatedAt: new Date(),
        })
        .where(eq(listings.id, listingId))

      if (listing.seller?.email) {
        await sendStatusChangeEmail({
          recipientEmail: listing.seller.email,
          recipientName: listing.seller.name || 'Seller',
          listingTitle: listing.title || 'Your listing',
          listingId: listing.id,
          newStatus: 'rejected',
          rejectionReason: fullReason,
        })
      }

      revalidateListing(listingId)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}

export async function adminUpdateListing(
  actor: AdminActor,
  listingId: string,
  input: Partial<ListingFormData>,
) {
  const { result, auditId } = await withAudit(
    actor,
    'listing.update',
    { type: 'listing', id: listingId },
    { listingId, fields: Object.keys(input) },
    async () => {
      // Validate server-side — the zod schemas were wired only into the client
      // resolver, so nothing enforced types, ranges or max lengths on a direct
      // action invocation. Parsed output strips unknown keys.
      const data = parseListingPatch(input)

      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, listingId),
      })

      if (!listing) throw new Error('Listing not found')

      // Generate title from locations if provided; admin keeps the existing title otherwise.
      const title = data.locations?.map(l => l.name).join(' + ') || listing.title

      // Atomic edit (DEBT-027): parent update + location/photo delete-reinserts commit
      // in ONE neon-http batch. Async resolution (owner directory + geocode) runs
      // inside buildLocationSync BEFORE the batch is composed.
      const parentUpdate = db.update(listings)
        .set({
          title,
          ...buildListingUpdate(data, listing),
          updatedAt: new Date(),
        })
        .where(eq(listings.id, listingId))

      const childWrites: BatchItem<'pg'>[] = []
      if (data.locations) {
        childWrites.push(...(await buildLocationSync(listingId, data.locations)))
      }
      if (data.photos) {
        childWrites.push(...buildPhotoSync(listingId, data.photos))
      }

      if (childWrites.length > 0) {
        await db.batch([parentUpdate, ...childWrites])
      } else {
        await parentUpdate
      }

      revalidateListing(listingId)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}

export async function adminMarkSold(actor: AdminActor, listingId: string) {
  const { result, auditId } = await withAudit(
    actor,
    'listing.mark_sold',
    { type: 'listing', id: listingId },
    { listingId },
    async () => {
      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, listingId),
      })

      if (!listing) throw new Error('Listing not found')

      if (!canTransition(listing.status as ListingStatus, 'sold', 'admin')) {
        throw new Error(`Cannot mark listing as sold from status ${listing.status}`)
      }

      await db.update(listings)
        .set({
          status: 'sold',
          updatedAt: new Date(),
        })
        .where(eq(listings.id, listingId))

      revalidateListing(listingId)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}
```

- [ ] **Step 5: Replace `src/lib/admin/actions.ts` with wrappers**

Overwrite the whole file:

```ts
'use server'

import { requireAdmin } from '@/lib/auth-guards'
import { uiActorFromSession } from '@/lib/admin/core/actor'
import * as core from '@/lib/admin/core/listings'
import type { ListingStatus, ListingFormData } from '@/lib/listings/types'

/**
 * Admin listing-moderation server actions. Each export is a public POST
 * endpoint, so every one begins with `requireAdmin()`. The logic lives in
 * src/lib/admin/core/listings.ts so the MCP server can share it.
 */

export async function getPendingListings() {
  await requireAdmin()
  return core.getPendingListings()
}

export async function getAllListings(statusFilter?: ListingStatus) {
  await requireAdmin()
  return core.getAllListings(statusFilter)
}

export async function approveListing(listingId: string) {
  const admin = await requireAdmin()
  return core.approveListing(uiActorFromSession(admin), listingId)
}

export async function rejectListing(listingId: string, reason: string, notes?: string) {
  const admin = await requireAdmin()
  return core.rejectListing(uiActorFromSession(admin), listingId, reason, notes)
}

export async function adminUpdateListing(listingId: string, input: Partial<ListingFormData>) {
  const admin = await requireAdmin()
  return core.adminUpdateListing(uiActorFromSession(admin), listingId, input)
}

export async function adminMarkSold(listingId: string) {
  const admin = await requireAdmin()
  return core.adminMarkSold(uiActorFromSession(admin), listingId)
}
```

- [ ] **Step 6: Make sure the existing tests' mocked sessions carry an id**

In `src/__tests__/listings/write-path-guards.test.ts`, `admin-edit-parity.test.ts`, and `analytics/listed-at-wiring.test.ts`, find where `mockAuth` resolves an admin session (e.g. `mockAuth.mockResolvedValue({ user: { role: "admin" } })`). If the `user` object lacks `id`, add `id: "admin-1"`. (`uiActorFromSession` throws without it.)

- [ ] **Step 7: Run the affected tests**

Run: `npx vitest run src/__tests__/admin/core-listings.test.ts src/__tests__/listings src/__tests__/analytics`
Expected: PASS, all files.

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit && npx eslint src/lib/admin src/__tests__/admin src/__tests__/listings src/__tests__/analytics
git add src/lib/admin/core/listings.ts src/lib/admin/actions.ts src/__tests__/admin/core-listings.test.ts src/__tests__/listings/write-path-guards.test.ts src/__tests__/listings/admin-edit-parity.test.ts src/__tests__/analytics/listed-at-wiring.test.ts
git commit -m "refactor(admin): extract listing moderation into audited core module

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Extract user and allowlist core

**Files:**
- Create: `src/lib/admin/core/users.ts`
- Create: `src/lib/admin/core/allowlist.ts`
- Modify: `src/app/admin/users/actions.ts`
- Modify: `src/__tests__/admin.test.ts` (audit mock)
- Test: `src/__tests__/admin/core-users.test.ts`

**Interfaces:**
- Produces (`@/lib/admin/core/users`):
  ```ts
  export function getUsers()
  export function setUserRole(actor: AdminActor, userId: string, role: "user" | "admin"): Promise<{ auditId: string }>
  export function setSellerAccess(actor: AdminActor, userId: string, sellerAccess: boolean): Promise<{ auditId: string }>
  export function removeUser(actor: AdminActor, userId: string): Promise<{ auditId: string }>
  ```
  (`@/lib/admin/core/allowlist`):
  ```ts
  export function getAllowlist()
  export function addToAllowlist(actor: AdminActor, raw: string): Promise<{ ok: true; auditId: string } | { ok: false; error: string; auditId: string }>
  export function removeFromAllowlist(actor: AdminActor, email: string): Promise<{ auditId: string }>
  ```

- [ ] **Step 1: Add the audit mock to `src/__tests__/admin.test.ts`**

After `vi.mock("next/cache", ...)` add:

```ts
vi.mock("@/lib/admin/audit", () => ({
  withAudit: async (
    _actor: unknown,
    _action: unknown,
    _target: unknown,
    _args: unknown,
    fn: () => Promise<unknown>,
  ) => ({ result: await fn(), auditId: "audit-test" }),
  recordMcpRead: async () => "audit-test",
}))
```

- [ ] **Step 2: Write the failing core test**

```ts
// src/__tests__/admin/core-users.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { select, update, del, usersFindFirst, allowlistFindFirst, insert, updateSetCalls, withAudit } = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = []
  return {
    select: vi.fn(),
    updateSetCalls,
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    del: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    usersFindFirst: vi.fn(),
    allowlistFindFirst: vi.fn(),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    withAudit: vi.fn(
      async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, fn: () => Promise<unknown>) => ({
        result: await fn(),
        auditId: "audit-1",
      }),
    ),
  }
})

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/db", () => ({
  db: {
    select,
    update,
    delete: del,
    insert,
    query: {
      users: { findFirst: usersFindFirst },
      allowlist: { findFirst: allowlistFindFirst },
    },
  },
}))

import { setUserRole, removeUser } from "@/lib/admin/core/users"
import { addToAllowlist } from "@/lib/admin/core/allowlist"

const actor = { userId: "admin-1", source: "ui" as const }

function setAdminCount(n: number) {
  select.mockReturnValue({ from: () => ({ where: () => Promise.resolve([{ count: n }]) }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
})

describe("core setUserRole", () => {
  it("blocks the last admin demoting themselves, using the actor id", async () => {
    setAdminCount(1)
    await expect(setUserRole(actor, "admin-1", "user")).rejects.toThrow("Cannot demote the last admin")
    expect(update).not.toHaveBeenCalled()
  })

  it("promotes and returns the audit id", async () => {
    expect(await setUserRole(actor, "u2", "admin")).toEqual({ auditId: "audit-1" })
    expect(updateSetCalls[0]).toEqual({ role: "admin" })
    expect(withAudit).toHaveBeenCalledWith(actor, "user.set_role", { type: "user", id: "u2" }, { userId: "u2", role: "admin" }, expect.any(Function))
  })
})

describe("core removeUser", () => {
  it("refuses to remove the actor", async () => {
    await expect(removeUser(actor, "admin-1")).rejects.toThrow("Cannot remove yourself")
    expect(del).not.toHaveBeenCalled()
  })

  it("refuses to remove the last admin", async () => {
    usersFindFirst.mockResolvedValue({ id: "a2", role: "admin" })
    setAdminCount(1)
    await expect(removeUser(actor, "a2")).rejects.toThrow("Cannot remove the last admin")
  })

  it("deletes a plain user", async () => {
    usersFindFirst.mockResolvedValue({ id: "u3", role: "user" })
    expect(await removeUser(actor, "u3")).toEqual({ auditId: "audit-1" })
    expect(del).toHaveBeenCalledTimes(1)
  })
})

describe("core addToAllowlist", () => {
  it("returns ok:false for a duplicate without inserting, and still carries auditId", async () => {
    allowlistFindFirst.mockResolvedValue({ email: "a@b.com" })
    expect(await addToAllowlist(actor, "a@b.com")).toEqual({ ok: false, error: "Email already in allowlist", auditId: "audit-1" })
    expect(insert).not.toHaveBeenCalled()
  })

  it("inserts a new domain entry stamped with the actor", async () => {
    allowlistFindFirst.mockResolvedValue(undefined)
    const values = vi.fn().mockResolvedValue(undefined)
    insert.mockReturnValue({ values })
    expect(await addToAllowlist(actor, "@partner.com")).toEqual({ ok: true, auditId: "audit-1" })
    expect(values).toHaveBeenCalledWith({ email: "@partner.com", addedBy: "admin-1" })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/admin/core-users.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Create `core/users.ts`**

```ts
// src/lib/admin/core/users.ts
/**
 * User administration core — shared by src/app/admin/users/actions.ts and the
 * MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. These functions take
 * a trusted `AdminActor` and do NOT check auth themselves. Do not re-export
 * them from a `"use server"` module and do not add `"use server"` here.
 */
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { eq, count } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

export async function getUsers() {
  return db.select().from(users).orderBy(users.createdAt)
}

async function adminCount(): Promise<number> {
  const rows = await db.select({ count: count() }).from(users).where(eq(users.role, "admin"))
  return rows[0].count
}

export async function setUserRole(actor: AdminActor, userId: string, role: "user" | "admin") {
  const { auditId } = await withAudit(
    actor,
    "user.set_role",
    { type: "user", id: userId },
    { userId, role },
    async () => {
      // Prevent last admin from demoting themselves
      if (role === "user" && userId === actor.userId) {
        if ((await adminCount()) <= 1) {
          throw new Error("Cannot demote the last admin")
        }
      }
      await db.update(users).set({ role }).where(eq(users.id, userId))
      revalidatePath("/admin/users")
    },
  )
  return { auditId }
}

export async function setSellerAccess(actor: AdminActor, userId: string, sellerAccess: boolean) {
  const { auditId } = await withAudit(
    actor,
    "user.set_seller_access",
    { type: "user", id: userId },
    { userId, sellerAccess },
    async () => {
      await db.update(users).set({ sellerAccess }).where(eq(users.id, userId))
      revalidatePath("/admin/users")
    },
  )
  return { auditId }
}

export async function removeUser(actor: AdminActor, userId: string) {
  const { auditId } = await withAudit(
    actor,
    "user.remove",
    { type: "user", id: userId },
    { userId },
    async () => {
      if (userId === actor.userId) {
        throw new Error("Cannot remove yourself")
      }

      // Prevent removing last admin
      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, userId),
      })

      if (targetUser?.role === "admin") {
        if ((await adminCount()) <= 1) {
          throw new Error("Cannot remove the last admin")
        }
      }

      await db.delete(users).where(eq(users.id, userId))
      revalidatePath("/admin/users")
    },
  )
  return { auditId }
}
```

- [ ] **Step 5: Create `core/allowlist.ts`**

```ts
// src/lib/admin/core/allowlist.ts
/**
 * Allowlist administration core — shared by src/app/admin/users/actions.ts
 * and the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. These functions take
 * a trusted `AdminActor` and do NOT check auth themselves. Do not re-export
 * them from a `"use server"` module and do not add `"use server"` here.
 */
import { db } from "@/db"
import { allowlist } from "@/db/schema/auth"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { parseAllowlistEntry } from "@/lib/auth/allowlist-entry"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

export async function getAllowlist() {
  return db.select().from(allowlist).orderBy(allowlist.addedAt)
}

/**
 * Add an individual address (`jane@partnerbrand.com`) or a whole company
 * (`@partnerbrand.com`). User-facing problems come back as `{ ok:false, error }`
 * rather than thrown, because Next redacts thrown server-action messages in
 * production.
 */
export async function addToAllowlist(actor: AdminActor, raw: string) {
  const { result, auditId } = await withAudit(
    actor,
    "allowlist.add",
    { type: "allowlist", id: null },
    { raw },
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      const parsed = parseAllowlistEntry(raw)
      if (!parsed.ok) return { ok: false, error: parsed.error }
      const { entry } = parsed

      const existing = await db.query.allowlist.findFirst({
        where: eq(allowlist.email, entry.value),
      })

      if (existing) {
        return {
          ok: false,
          error: entry.kind === "domain" ? "Domain already in allowlist" : "Email already in allowlist",
        }
      }

      await db.insert(allowlist).values({
        email: entry.value,
        addedBy: actor.userId,
      })

      revalidatePath("/admin/users")
      return { ok: true }
    },
  )
  return { ...result, auditId }
}

export async function removeFromAllowlist(actor: AdminActor, email: string) {
  const normalized = email.trim().toLowerCase()
  const { auditId } = await withAudit(
    actor,
    "allowlist.remove",
    { type: "allowlist", id: normalized },
    { email: normalized },
    async () => {
      await db.delete(allowlist).where(eq(allowlist.email, normalized))
      revalidatePath("/admin/users")
    },
  )
  return { auditId }
}
```

- [ ] **Step 6: Replace `src/app/admin/users/actions.ts` with wrappers**

```ts
"use server"

import { requireAdmin } from "@/lib/auth-guards"
import { uiActorFromSession } from "@/lib/admin/core/actor"
import * as usersCore from "@/lib/admin/core/users"
import * as allowlistCore from "@/lib/admin/core/allowlist"

/**
 * Admin user/allowlist server actions. Each export is a public POST endpoint,
 * so every one begins with `requireAdmin()`. Logic lives in
 * src/lib/admin/core/{users,allowlist}.ts so the MCP server can share it.
 */

export async function getUsers() {
  await requireAdmin()
  return usersCore.getUsers()
}

export async function getAllowlist() {
  await requireAdmin()
  return allowlistCore.getAllowlist()
}

export async function setUserRole(userId: string, role: "user" | "admin") {
  const admin = await requireAdmin()
  return usersCore.setUserRole(uiActorFromSession(admin), userId, role)
}

export async function setSellerAccess(userId: string, sellerAccess: boolean) {
  const admin = await requireAdmin()
  return usersCore.setSellerAccess(uiActorFromSession(admin), userId, sellerAccess)
}

export async function addToAllowlist(raw: string) {
  const admin = await requireAdmin()
  return allowlistCore.addToAllowlist(uiActorFromSession(admin), raw)
}

export async function removeFromAllowlist(email: string) {
  const admin = await requireAdmin()
  return allowlistCore.removeFromAllowlist(uiActorFromSession(admin), email)
}

export async function removeUser(userId: string) {
  const admin = await requireAdmin()
  return usersCore.removeUser(uiActorFromSession(admin), userId)
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/__tests__/admin/core-users.test.ts src/__tests__/admin.test.ts`
Expected: PASS. (`admin.test.ts` already resolves `{ user: { id: "admin-1", role: "admin" } }`, so the wrappers can build an actor.)

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit
git add src/lib/admin/core/users.ts src/lib/admin/core/allowlist.ts src/app/admin/users/actions.ts src/__tests__/admin.test.ts src/__tests__/admin/core-users.test.ts
git commit -m "refactor(admin): extract user + allowlist admin into audited core modules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Extract brand-request admin core

**Files:**
- Create: `src/lib/admin/core/brand-requests.ts`
- Modify: `src/lib/brand-requests/actions.ts` (admin exports → wrappers; `submitBrandRequest` unchanged)
- Modify: `src/__tests__/brand-requests/actions.test.ts` (audit mock)
- Test: `src/__tests__/admin/core-brand-requests.test.ts`

**Interfaces:**
- Produces (`@/lib/admin/core/brand-requests`):
  ```ts
  export function approveBrandRequest(actor: AdminActor, requestId: string, options?: { withoutRecon?: boolean }): Promise<{ success: true; dispatched: boolean; auditId: string }>
  export function rejectBrandRequest(actor: AdminActor, requestId: string, reason: string): Promise<{ success: true; auditId: string }>
  export function retryMonitorDispatch(actor: AdminActor, requestId: string, kind: "recon" | "build"): Promise<{ success: true; auditId: string }>
  ```

- [ ] **Step 1: Add the audit mock to `src/__tests__/brand-requests/actions.test.ts`**

After `vi.mock("next/cache", ...)`:

```ts
vi.mock("@/lib/admin/audit", () => ({
  withAudit: async (
    _actor: unknown,
    _action: unknown,
    _target: unknown,
    _args: unknown,
    fn: () => Promise<unknown>,
  ) => ({ result: await fn(), auditId: "audit-test" }),
  recordMcpRead: async () => "audit-test",
}))
```

Also check the admin-session mock in that file's `beforeEach`; it must include `id` (e.g. `mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "admin" } })`). Add the id if missing.

- [ ] **Step 2: Write the failing core test**

```ts
// src/__tests__/admin/core-brand-requests.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { findFirst, update, updateSetCalls, dispatch, withAudit } = vi.hoisted(() => {
  const updateSetCalls: Record<string, unknown>[] = []
  return {
    findFirst: vi.fn(),
    updateSetCalls,
    update: vi.fn(() => ({
      set: (payload: Record<string, unknown>) => {
        updateSetCalls.push(payload)
        return { where: vi.fn().mockResolvedValue(undefined) }
      },
    })),
    dispatch: vi.fn(),
    withAudit: vi.fn(
      async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, fn: () => Promise<unknown>) => ({
        result: await fn(),
        auditId: "audit-1",
      }),
    ),
  }
})

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/lib/brand-requests/dispatch", () => ({ dispatchMonitorEvent: dispatch }))
vi.mock("@/db", () => ({
  db: { update, query: { brandRequests: { findFirst } } },
}))

import { approveBrandRequest, rejectBrandRequest } from "@/lib/admin/core/brand-requests"

const actor = { userId: "admin-1", source: "mcp" as const, clientId: "claude-code", tokenId: "t1" }

beforeEach(() => {
  vi.clearAllMocks()
  updateSetCalls.length = 0
})

describe("core approveBrandRequest", () => {
  it("approves a recon_complete request, stamping decidedBy from the actor", async () => {
    findFirst.mockResolvedValue({ id: "r1", status: "recon_complete" })
    dispatch.mockResolvedValue({ ok: true })
    expect(await approveBrandRequest(actor, "r1")).toEqual({ success: true, dispatched: true, auditId: "audit-1" })
    expect(updateSetCalls[0]).toMatchObject({ status: "approved", decidedBy: "admin-1" })
    expect(dispatch).toHaveBeenCalledWith("brand-build", "r1")
  })

  it("refuses to approve before recon without the override", async () => {
    findFirst.mockResolvedValue({ id: "r1", status: "submitted" })
    await expect(approveBrandRequest(actor, "r1")).rejects.toThrow(/Recon has not completed/)
    expect(update).not.toHaveBeenCalled()
  })
})

describe("core rejectBrandRequest", () => {
  it("requires a reason", async () => {
    findFirst.mockResolvedValue({ id: "r1", status: "submitted" })
    await expect(rejectBrandRequest(actor, "r1", "   ")).rejects.toThrow("A rejection reason is required.")
  })

  it("rejects and records the reason", async () => {
    findFirst.mockResolvedValue({ id: "r1", status: "submitted" })
    expect(await rejectBrandRequest(actor, "r1", "Not a fit")).toEqual({ success: true, auditId: "audit-1" })
    expect(updateSetCalls[0]).toMatchObject({ status: "rejected", rejectReason: "Not a fit", decidedBy: "admin-1" })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/admin/core-brand-requests.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create the core module**

```ts
// src/lib/admin/core/brand-requests.ts
/**
 * Brand-request admin core — shared by src/lib/brand-requests/actions.ts and
 * the MCP write tools. `submitBrandRequest` (franchisee-facing) stays in the
 * actions file; only the admin decisions live here.
 *
 * This module is deliberately NOT a `"use server"` file. These functions take
 * a trusted `AdminActor` and do NOT check auth themselves. Do not re-export
 * them from a `"use server"` module and do not add `"use server"` here.
 *
 * `updated_at` is always set explicitly — Postgres does not refresh it on
 * UPDATE, and the monitor repo relies on it to tell how stale a row is.
 */
import { db } from '@/db'
import { brandRequests, type BrandRequestStatus } from '@/db/schema/brandRequests'
import { dispatchMonitorEvent } from '@/lib/brand-requests/dispatch'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { withAudit } from '@/lib/admin/audit'
import type { AdminActor } from './actor'

const ACCOUNT_PATH = '/account/brand-requests'
const ADMIN_PATH = '/admin/brand-requests'

/** Statuses past the point of no return — a decision has already been acted on. */
const APPROVED_STATUSES: BrandRequestStatus[] = ['approved', 'building', 'live']

/** Approving these requires the explicit `withoutRecon` override. */
const OVERRIDE_APPROVABLE: BrandRequestStatus[] = ['submitted', 'recon_running', 'needs_human']

/** Best-effort note on the row; never let a bookkeeping write mask the outcome. */
async function recordDispatchError(requestId: string, message: string) {
  try {
    await db
      .update(brandRequests)
      .set({ error: message, updatedAt: new Date() })
      .where(eq(brandRequests.id, requestId))
  } catch (err) {
    console.error('[brand-requests] could not record dispatch error', requestId, err)
  }
}

export async function approveBrandRequest(
  actor: AdminActor,
  requestId: string,
  options?: { withoutRecon?: boolean },
) {
  const { result, auditId } = await withAudit(
    actor,
    'brand_request.approve',
    { type: 'brand_request', id: requestId },
    { requestId, withoutRecon: options?.withoutRecon === true },
    async () => {
      const request = await db.query.brandRequests.findFirst({
        where: eq(brandRequests.id, requestId),
      })
      if (!request) throw new Error('Request not found')

      if (APPROVED_STATUSES.includes(request.status)) {
        throw new Error('Request is already approved.')
      }
      if (request.status === 'rejected') {
        throw new Error('Request was rejected. The franchisee can submit it again.')
      }

      // Normally we wait for recon so the admin sees the cost estimate first; the
      // override exists for brands we already know we want (or a stuck recon).
      const approvable =
        request.status === 'recon_complete' ||
        (options?.withoutRecon === true && OVERRIDE_APPROVABLE.includes(request.status))
      if (!approvable) {
        throw new Error(
          'Recon has not completed yet. Wait for the cost estimate or approve without recon.',
        )
      }

      await db
        .update(brandRequests)
        .set({
          status: 'approved',
          decidedBy: actor.userId,
          decidedAt: new Date(),
          rejectReason: null,
          updatedAt: new Date(),
        })
        .where(eq(brandRequests.id, requestId))

      // Approval is committed before the handoff and does NOT roll back on failure —
      // `dispatched: false` tells the UI to offer a retry.
      const dispatch = await dispatchMonitorEvent('brand-build', requestId)
      if (!dispatch.ok) {
        await recordDispatchError(requestId, `Build dispatch failed: ${dispatch.error}`)
      }

      revalidatePath(ADMIN_PATH)
      revalidatePath(`${ADMIN_PATH}/${requestId}`)
      revalidatePath(ACCOUNT_PATH)
      return { success: true as const, dispatched: dispatch.ok }
    },
  )
  return { ...result, auditId }
}

export async function rejectBrandRequest(actor: AdminActor, requestId: string, reason: string) {
  const { result, auditId } = await withAudit(
    actor,
    'brand_request.reject',
    { type: 'brand_request', id: requestId },
    { requestId, reason },
    async () => {
      const request = await db.query.brandRequests.findFirst({
        where: eq(brandRequests.id, requestId),
      })
      if (!request) throw new Error('Request not found')

      // The reason is shown to the franchisee, so it must be present and readable.
      const trimmed = reason.trim()
      if (!trimmed) throw new Error('A rejection reason is required.')
      if (trimmed.length > 500) {
        throw new Error('Keep the rejection reason under 500 characters.')
      }

      if (request.status === 'rejected') {
        throw new Error('Request is already rejected.')
      }
      if (APPROVED_STATUSES.includes(request.status)) {
        throw new Error(
          'Request is already approved and being set up — it can no longer be rejected.',
        )
      }

      await db
        .update(brandRequests)
        .set({
          status: 'rejected',
          rejectReason: trimmed,
          decidedBy: actor.userId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(brandRequests.id, requestId))

      revalidatePath(ADMIN_PATH)
      revalidatePath(`${ADMIN_PATH}/${requestId}`)
      revalidatePath(ACCOUNT_PATH)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}

/**
 * Re-fire a handoff that failed (or that the monitor never picked up). Gated on
 * status so a retry can't restart a pipeline stage that already moved past it.
 */
export async function retryMonitorDispatch(
  actor: AdminActor,
  requestId: string,
  kind: 'recon' | 'build',
) {
  const { result, auditId } = await withAudit(
    actor,
    'brand_request.retry_dispatch',
    { type: 'brand_request', id: requestId },
    { requestId, kind },
    async () => {
      const request = await db.query.brandRequests.findFirst({
        where: eq(brandRequests.id, requestId),
      })
      if (!request) throw new Error('Request not found')

      const allowed: BrandRequestStatus[] =
        kind === 'recon' ? ['submitted', 'recon_running'] : ['approved', 'building']
      if (!allowed.includes(request.status)) {
        throw new Error(`Cannot retry ${kind} dispatch from status "${request.status}".`)
      }

      const dispatch = await dispatchMonitorEvent(
        kind === 'recon' ? 'brand-recon' : 'brand-build',
        requestId,
      )
      if (!dispatch.ok) {
        await recordDispatchError(requestId, `Dispatch failed: ${dispatch.error}`)
        throw new Error(`Dispatch failed: ${dispatch.error}`)
      }

      // Handoff accepted — clear the stale failure note.
      await db
        .update(brandRequests)
        .set({ error: null, updatedAt: new Date() })
        .where(eq(brandRequests.id, requestId))

      revalidatePath(`${ADMIN_PATH}/${requestId}`)
      revalidatePath(ADMIN_PATH)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}
```

- [ ] **Step 5: Turn the admin exports in `src/lib/brand-requests/actions.ts` into wrappers**

Delete everything from the `APPROVED_STATUSES` const through the end of the file **except** `recordDispatchError`, `submitSchema`, and `submitBrandRequest` (which still uses `recordDispatchError`, `ACCOUNT_PATH`, `ADMIN_PATH`). Then remove the now-unused `BrandRequestStatus` type import and append:

```ts
// ---- Admin decisions: thin wrappers over src/lib/admin/core/brand-requests.ts ----

export async function approveBrandRequest(
  requestId: string,
  options?: { withoutRecon?: boolean },
) {
  const admin = await requireAdmin()
  return core.approveBrandRequest(uiActorFromSession(admin), requestId, options)
}

export async function rejectBrandRequest(requestId: string, reason: string) {
  const admin = await requireAdmin()
  return core.rejectBrandRequest(uiActorFromSession(admin), requestId, reason)
}

export async function retryMonitorDispatch(requestId: string, kind: 'recon' | 'build') {
  const admin = await requireAdmin()
  return core.retryMonitorDispatch(uiActorFromSession(admin), requestId, kind)
}
```

Add imports at the top:

```ts
import { uiActorFromSession } from '@/lib/admin/core/actor'
import * as core from '@/lib/admin/core/brand-requests'
```

Keep the existing `requireAdmin` import. Remove `APPROVED_STATUSES` / `OVERRIDE_APPROVABLE` constants from this file (they moved to core).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/__tests__/admin/core-brand-requests.test.ts src/__tests__/brand-requests`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit && npx eslint src/lib/brand-requests src/lib/admin
git add src/lib/admin/core/brand-requests.ts src/lib/brand-requests/actions.ts src/__tests__/brand-requests/actions.test.ts src/__tests__/admin/core-brand-requests.test.ts
git commit -m "refactor(admin): extract brand-request decisions into audited core module

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Extract owner-link and owner-directory core

**Files:**
- Create: `src/lib/admin/core/owner-links.ts`
- Create: `src/lib/admin/core/owner-directory.ts`
- Modify: `src/lib/owner-directory/actions.ts`
- Modify: `src/__tests__/owner-directory/actions.test.ts` (audit mock)
- Test: `src/__tests__/admin/core-owner-links.test.ts`

**Interfaces:**
- Produces (`@/lib/admin/core/owner-links`):
  ```ts
  type LinkResult = { ok: true; auditId: string } | { ok: false; error: string; auditId: string }
  export function addOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string): Promise<LinkResult>
  export function revokeOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string): Promise<LinkResult>
  export function clearOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string): Promise<LinkResult>
  ```
  (`@/lib/admin/core/owner-directory`):
  ```ts
  export function refreshOwnerDirectory(actor: AdminActor): Promise<{ ok: true; result: SyncResult; auditId: string } | { ok: false; error: string; auditId: string }>
  ```

- [ ] **Step 1: Add the audit mock to `src/__tests__/owner-directory/actions.test.ts`**

After `vi.mock("next/cache", ...)`:

```ts
vi.mock("@/lib/admin/audit", () => ({
  withAudit: async (
    _actor: unknown,
    _action: unknown,
    _target: unknown,
    _args: unknown,
    fn: () => Promise<unknown>,
  ) => ({ result: await fn(), auditId: "audit-test" }),
  recordMcpRead: async () => "audit-test",
}))
```

That file asserts `toEqual({ ok: true })` on results. Update those assertions to `toEqual({ ok: true, auditId: "audit-test" })` and the `{ ok:false, error }` ones to include `auditId: "audit-test"` as well. Run `npx vitest run src/__tests__/owner-directory/actions.test.ts` and fix each `toEqual` the diff reports.

- [ ] **Step 2: Write the failing core test**

```ts
// src/__tests__/admin/core-owner-links.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

const { select, insert, del, withAudit } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  del: vi.fn(),
  withAudit: vi.fn(
    async (_a: unknown, _b: unknown, _c: unknown, _d: unknown, fn: () => Promise<unknown>) => ({
      result: await fn(),
      auditId: "audit-1",
    }),
  ),
}))

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/admin/audit", () => ({ withAudit }))
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    insert: (...a: unknown[]) => insert(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

import { addOwnerLink, revokeOwnerLink } from "@/lib/admin/core/owner-links"

const actor = { userId: "admin-1", source: "ui" as const }

beforeEach(() => {
  vi.clearAllMocks()
})

describe("core addOwnerLink", () => {
  it("refuses Unknown Owner and returns ok:false with auditId", async () => {
    expect(await addOwnerLink(actor, "u1", "Unknown Owner")).toEqual({
      ok: false,
      error: "Unknown Owner cannot be assigned to a user",
      auditId: "audit-1",
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it("upserts source=manual stamped with the actor", async () => {
    select.mockReturnValue(builder([{ id: "ol-1" }]))
    const ins = builder(undefined)
    insert.mockReturnValue(ins)
    expect(await addOwnerLink(actor, "u1", "ut-towns")).toEqual({ ok: true, auditId: "audit-1" })
    expect(ins.calls.values[0][0]).toMatchObject({ userId: "u1", ownerIdentifier: "ut-towns", source: "manual", actorUserId: "admin-1" })
    expect(withAudit).toHaveBeenCalledWith(actor, "owner_link.add", { type: "owner_link", id: "u1:ut-towns" }, { userId: "u1", ownerIdentifier: "ut-towns" }, expect.any(Function))
  })
})

describe("core revokeOwnerLink", () => {
  it("upserts source=revoked without validating directory membership", async () => {
    const ins = builder(undefined)
    insert.mockReturnValue(ins)
    expect(await revokeOwnerLink(actor, "u1", "ghost")).toEqual({ ok: true, auditId: "audit-1" })
    expect(select).not.toHaveBeenCalled()
    expect(ins.calls.values[0][0]).toMatchObject({ source: "revoked", actorUserId: "admin-1" })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/admin/core-owner-links.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `core/owner-links.ts`**

```ts
// src/lib/admin/core/owner-links.ts
/**
 * User ↔ owner link administration core — shared by
 * src/lib/owner-directory/actions.ts and the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. These functions take
 * a trusted `AdminActor` and do NOT check auth themselves. Do not re-export
 * them from a `"use server"` module and do not add `"use server"` here.
 */
import { revalidatePath } from "next/cache"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { ownerLocations, userOwnerLinks } from "@/db/schema"
import { UNKNOWN_OWNER } from "@/lib/owner-directory/query"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

type LinkOutcome = { ok: true } | { ok: false; error: string }

/**
 * Upsert a link row. One row per (user, owner) — re-linking a previously
 * revoked owner flips the existing row instead of failing on the unique index.
 */
async function upsertLink(
  userId: string,
  ownerIdentifier: string,
  source: "manual" | "revoked",
  actorUserId: string,
): Promise<void> {
  await db
    .insert(userOwnerLinks)
    .values({ userId, ownerIdentifier, source, actorUserId })
    .onConflictDoUpdate({
      target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
      set: { source, actorUserId, updatedAt: sql`now()` },
    })
}

function linkTargetId(userId: string, ownerIdentifier: string) {
  return `${userId}:${ownerIdentifier}`
}

/**
 * Link a user to an owner_identifier (source=manual). Manual links are never
 * overwritten by the automatic email match. The owner must exist in the
 * directory and not be the Unknown Owner bucket.
 */
export async function addOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string) {
  const { result, auditId } = await withAudit(
    actor,
    "owner_link.add",
    { type: "owner_link", id: linkTargetId(userId, ownerIdentifier) },
    { userId, ownerIdentifier },
    async (): Promise<LinkOutcome> => {
      if (ownerIdentifier === UNKNOWN_OWNER) {
        return { ok: false, error: "Unknown Owner cannot be assigned to a user" }
      }

      const exists = await db
        .select({ id: ownerLocations.id })
        .from(ownerLocations)
        .where(
          and(
            eq(ownerLocations.ownerIdentifier, ownerIdentifier),
            ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER),
          ),
        )
        .limit(1)
      if (exists.length === 0) {
        return { ok: false, error: `Unknown owner_identifier: ${ownerIdentifier}` }
      }

      await upsertLink(userId, ownerIdentifier, "manual", actor.userId)
      revalidatePath("/admin/owner-directory")
      return { ok: true }
    },
  )
  return { ...result, auditId }
}

/**
 * Revoke one owner profile for a user. Durable — the login matcher skips
 * revoked owners. Deliberately does NOT validate directory membership so an
 * orphaned link can still be cleaned up.
 */
export async function revokeOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string) {
  const { result, auditId } = await withAudit(
    actor,
    "owner_link.revoke",
    { type: "owner_link", id: linkTargetId(userId, ownerIdentifier) },
    { userId, ownerIdentifier },
    async (): Promise<LinkOutcome> => {
      await upsertLink(userId, ownerIdentifier, "revoked", actor.userId)
      revalidatePath("/admin/owner-directory")
      return { ok: true }
    },
  )
  return { ...result, auditId }
}

/**
 * Delete a link row outright: undoes a revocation or removes a manual link.
 */
export async function clearOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string) {
  const { result, auditId } = await withAudit(
    actor,
    "owner_link.clear",
    { type: "owner_link", id: linkTargetId(userId, ownerIdentifier) },
    { userId, ownerIdentifier },
    async (): Promise<LinkOutcome> => {
      await db
        .delete(userOwnerLinks)
        .where(
          and(
            eq(userOwnerLinks.userId, userId),
            eq(userOwnerLinks.ownerIdentifier, ownerIdentifier),
          ),
        )
      revalidatePath("/admin/owner-directory")
      return { ok: true }
    },
  )
  return { ...result, auditId }
}
```

- [ ] **Step 5: Create `core/owner-directory.ts`**

```ts
// src/lib/admin/core/owner-directory.ts
/**
 * Owner-directory sync trigger — shared by src/lib/owner-directory/actions.ts
 * and the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. Takes a trusted
 * `AdminActor`; does NOT check auth. Do not re-export from a `"use server"`
 * module and do not add `"use server"` here.
 */
import { revalidatePath } from "next/cache"
import { syncOwnerLocations, type SyncResult } from "@/lib/owner-directory/sync"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

export async function refreshOwnerDirectory(actor: AdminActor) {
  const { result, auditId } = await withAudit(
    actor,
    "owner_directory.refresh",
    { type: "owner_directory", id: null },
    {},
    async (): Promise<{ ok: true; result: SyncResult } | { ok: false; error: string }> => {
      try {
        const result = await syncOwnerLocations()
        revalidatePath("/admin/owner-directory")
        return { ok: true, result }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "sync failed" }
      }
    },
  )
  return { ...result, auditId }
}
```

- [ ] **Step 6: Replace `src/lib/owner-directory/actions.ts` with wrappers**

```ts
"use server"

import { requireAdmin } from "@/lib/auth-guards"
import { uiActorFromSession } from "@/lib/admin/core/actor"
import * as links from "@/lib/admin/core/owner-links"
import * as directory from "@/lib/admin/core/owner-directory"

/**
 * Owner-directory admin server actions. Each export is a public POST endpoint,
 * so every one begins with `requireAdmin()`. Logic lives in
 * src/lib/admin/core/{owner-links,owner-directory}.ts so the MCP server can
 * share it.
 */

/** Admin-only "refresh now" trigger for the owner directory sync. */
export async function refreshOwnerDirectory() {
  const admin = await requireAdmin()
  return directory.refreshOwnerDirectory(uiActorFromSession(admin))
}

export async function addOwnerLink(userId: string, ownerIdentifier: string) {
  const admin = await requireAdmin()
  return links.addOwnerLink(uiActorFromSession(admin), userId, ownerIdentifier)
}

export async function revokeOwnerLink(userId: string, ownerIdentifier: string) {
  const admin = await requireAdmin()
  return links.revokeOwnerLink(uiActorFromSession(admin), userId, ownerIdentifier)
}

export async function clearOwnerLink(userId: string, ownerIdentifier: string) {
  const admin = await requireAdmin()
  return links.clearOwnerLink(uiActorFromSession(admin), userId, ownerIdentifier)
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/__tests__/admin/core-owner-links.test.ts src/__tests__/owner-directory`
Expected: PASS. Note the existing owner-directory test mocks `@/lib/auth-guards` with `requireAdmin` resolving `{ id: "admin-1", role: "admin" }`, which satisfies `uiActorFromSession`. It also mocks `@/lib/owner-directory/sync`; the core module imports the same path so the mock still applies.

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit
git add src/lib/admin/core/owner-links.ts src/lib/admin/core/owner-directory.ts src/lib/owner-directory/actions.ts src/__tests__/owner-directory/actions.test.ts src/__tests__/admin/core-owner-links.test.ts
git commit -m "refactor(admin): extract owner link + directory refresh into audited core

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Extract data-mapping core and normalize its guard

**Files:**
- Create: `src/lib/admin/core/data-mappings.ts`
- Modify: `src/lib/data/mapping-actions.ts`
- Modify: `src/__tests__/data/mapping-actions.test.ts`

**Interfaces:**
- Produces (`@/lib/admin/core/data-mappings`):
  ```ts
  export function setLocationMapping(actor: AdminActor, locationId: string, input: { bqLocationName: string | null; status: "confirmed" | "not_connected" }): Promise<{ ok: true; auditId: string } | { ok: false; error: string; auditId: string }>
  ```

- [ ] **Step 1: Update the existing test for the new guard and return shape**

In `src/__tests__/data/mapping-actions.test.ts`:
- Add the audit pass-through mock after the `vi.mock("server-only", ...)` line:
  ```ts
  vi.mock("@/lib/admin/audit", () => ({
    withAudit: async (
      _actor: unknown,
      _action: unknown,
      _target: unknown,
      _args: unknown,
      fn: () => Promise<unknown>,
    ) => ({ result: await fn(), auditId: "audit-test" }),
    recordMcpRead: async () => "audit-test",
  }))
  ```
- Change the `beforeEach` admin session to `auth.mockReset().mockResolvedValue({ user: { id: "admin-1", role: "admin" } })`.
- Replace the first test body:
  ```ts
  it("rejects non-admins without touching the DB", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "user" } })
    await expect(
      setLocationMapping("ll-1", { bqLocationName: "X", status: "confirmed" }),
    ).rejects.toThrow(/Unauthorized/)
    expect(update).not.toHaveBeenCalled()
  })
  ```
- Every remaining `toEqual({ ok: true })` becomes `toEqual({ ok: true, auditId: "audit-test" })`, and `toEqual({ ok: false, error: "A location is required to confirm." })` becomes `toEqual({ ok: false, error: "A location is required to confirm.", auditId: "audit-test" })`.

Run: `npx vitest run src/__tests__/data/mapping-actions.test.ts` → FAIL (guard still returns `{ ok:false }`, no auditId).

- [ ] **Step 2: Create the core module**

```ts
// src/lib/admin/core/data-mappings.ts
/**
 * BigQuery data-mapping core — shared by src/lib/data/mapping-actions.ts and
 * the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. Takes a trusted
 * `AdminActor`; does NOT check auth. Do not re-export from a `"use server"`
 * module and do not add `"use server"` here.
 */
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { getMondayCoordsByLocationNumber } from "@/lib/bigquery/queries"
import { mondayCoordsForBqName } from "@/lib/owner-directory/monday-coords"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

export type LocationMappingInput = {
  bqLocationName: string | null
  status: "confirmed" | "not_connected"
}

export async function setLocationMapping(
  actor: AdminActor,
  locationId: string,
  input: LocationMappingInput,
) {
  const { result, auditId } = await withAudit(
    actor,
    "listing_location.set_data_mapping",
    { type: "listing_location", id: locationId },
    { locationId, ...input },
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
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
    },
  )
  return { ...result, auditId }
}
```

- [ ] **Step 3: Replace `src/lib/data/mapping-actions.ts` with a wrapper**

```ts
"use server"

import { requireAdmin } from "@/lib/auth-guards"
import { uiActorFromSession } from "@/lib/admin/core/actor"
import { setLocationMapping as setLocationMappingCore, type LocationMappingInput } from "@/lib/admin/core/data-mappings"

/**
 * Admin data-mapping server action. Public POST endpoint → begins with
 * `requireAdmin()` (throws), matching every other admin action. Logic lives in
 * src/lib/admin/core/data-mappings.ts so the MCP server can share it.
 */
export async function setLocationMapping(locationId: string, input: LocationMappingInput) {
  const admin = await requireAdmin()
  return setLocationMappingCore(uiActorFromSession(admin), locationId, input)
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/__tests__/data/mapping-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Check the UI caller still compiles**

`src/components/admin/DataMappings.tsx:76-80` reads `res.ok` / `res.error` from the result; the new shape is a superset. Run `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin/core/data-mappings.ts src/lib/data/mapping-actions.ts src/__tests__/data/mapping-actions.test.ts
git commit -m "refactor(admin): extract data-mapping core; setLocationMapping uses requireAdmin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Extract admin read queries (inquiries, analytics)

**Files:**
- Create: `src/lib/admin/core/inquiries.ts`
- Create: `src/lib/admin/core/analytics.ts`
- Modify: `src/app/admin/inquiries/actions.ts`
- Modify: `src/app/admin/analytics/actions.ts`
- Test: `src/__tests__/admin/core-reads.test.ts`

**Interfaces:**
- Produces (`@/lib/admin/core/inquiries`): `getInquiries(opts?: { limit?: number })` (default 100).
- Produces (`@/lib/admin/core/analytics`): `getAnalyticsSummary(): Promise<AnalyticsSummary>`, `getLoginTrend(): Promise<LoginTrendPoint[]>`, `getUserAnalytics(): Promise<UserAnalyticsRow[]>`, and re-exported types `AnalyticsSummary`, `UserAnalyticsRow`, `LoginTrendPoint`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/admin/core-reads.test.ts
import { describe, it, expect, vi } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

const { select } = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

import { getInquiries } from "@/lib/admin/core/inquiries"

describe("core getInquiries", () => {
  it("defaults to the last 100 and honors a custom limit", async () => {
    const b = builder([{ id: "c1" }])
    select.mockReturnValue(b)
    expect(await getInquiries()).toEqual([{ id: "c1" }])
    expect(b.calls.limit[0]).toEqual([100])

    const b2 = builder([])
    select.mockReturnValue(b2)
    await getInquiries({ limit: 25 })
    expect(b2.calls.limit[0]).toEqual([25])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/admin/core-reads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `core/inquiries.ts`**

```ts
// src/lib/admin/core/inquiries.ts
/**
 * Admin inquiry read model — shared by src/app/admin/inquiries/actions.ts and
 * the MCP read tools. NOT a `"use server"` file; does not check auth.
 */
import { db } from "@/db"
import { contacts } from "@/db/schema/contacts"
import { listings, listingLocations } from "@/db/schema/listings"
import { users } from "@/db/schema/auth"
import { eq, desc } from "drizzle-orm"

export async function getInquiries(opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 100
  return db
    .select({
      id: contacts.id,
      message: contacts.message,
      buyerName: contacts.buyerName,
      buyerEmail: contacts.buyerEmail,
      buyerPhone: contacts.buyerPhone,
      createdAt: contacts.createdAt,
      listingId: contacts.listingId,
      listingTitle: listings.title,
      listingLocationName: listingLocations.name,
      listingCity: listingLocations.city,
      listingState: listingLocations.state,
      sellerName: users.name,
      sellerEmail: users.email,
    })
    .from(contacts)
    .innerJoin(listings, eq(contacts.listingId, listings.id))
    .innerJoin(users, eq(listings.sellerId, users.id))
    .leftJoin(listingLocations, eq(listingLocations.listingId, listings.id))
    .orderBy(desc(contacts.createdAt))
    .limit(limit)
}
```

- [ ] **Step 4: Create `core/analytics.ts`**

Move the bodies of `getAnalyticsSummary`, `getLoginTrend`, `getUserAnalytics` and the `daysAgo` helper and the two interfaces from `src/app/admin/analytics/actions.ts` verbatim, minus the `requireAdmin()` lines, into:

```ts
// src/lib/admin/core/analytics.ts
/**
 * Admin analytics read model — shared by src/app/admin/analytics/actions.ts
 * and the MCP read tools. NOT a `"use server"` file; does not check auth.
 */
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { listings } from "@/db/schema/listings"
import { contacts } from "@/db/schema/contacts"
import { favorites } from "@/db/schema/favorites"
import { loginEvents } from "@/db/schema/loginEvents"
import { count, countDistinct, eq, gte, sql } from "drizzle-orm"
import { fillTrend, type LoginTrendPoint } from "@/app/admin/analytics/trend"

export type { LoginTrendPoint }

export interface AnalyticsSummary {
  totalUsers: number
  activeThisWeek: number
  logins30d: number
  inquiries30d: number
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

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
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
  const day = sql<string>`to_char(${loginEvents.createdAt}, 'YYYY-MM-DD')`
  const rows = await db
    .select({ date: day, count: count() })
    .from(loginEvents)
    .where(gte(loginEvents.createdAt, daysAgo(30)))
    .groupBy(day)
  return fillTrend(rows, 30, new Date())
}

export async function getUserAnalytics(): Promise<UserAnalyticsRow[]> {
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

- [ ] **Step 5: Replace the two action files with wrappers**

`src/app/admin/inquiries/actions.ts`:

```ts
"use server"

import { requireAdmin } from "@/lib/auth-guards"
import * as core from "@/lib/admin/core/inquiries"

export async function getInquiries() {
  await requireAdmin()
  return core.getInquiries()
}
```

`src/app/admin/analytics/actions.ts`:

```ts
"use server"

import { requireAdmin } from "@/lib/auth-guards"
import * as core from "@/lib/admin/core/analytics"

export type { AnalyticsSummary, UserAnalyticsRow, LoginTrendPoint } from "@/lib/admin/core/analytics"

export async function getAnalyticsSummary() {
  await requireAdmin()
  return core.getAnalyticsSummary()
}

export async function getLoginTrend() {
  await requireAdmin()
  return core.getLoginTrend()
}

export async function getUserAnalytics() {
  await requireAdmin()
  return core.getUserAnalytics()
}
```

Check `grep -rn "admin/analytics/actions" src` — any importer of the types (e.g. `AnalyticsDashboard.tsx`) still resolves because the types are re-exported.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/__tests__/admin/core-reads.test.ts src/__tests__/analytics && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/admin/core/inquiries.ts src/lib/admin/core/analytics.ts src/app/admin/inquiries/actions.ts src/app/admin/analytics/actions.ts src/__tests__/admin/core-reads.test.ts
git commit -m "refactor(admin): move inquiry + analytics reads into core modules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Activity feed query

**Files:**
- Create: `src/lib/admin/activity.ts`
- Test: `src/__tests__/admin/activity.test.ts`

**Interfaces:**
- Produces (`@/lib/admin/activity`):
  ```ts
  export const ACTIVITY_KINDS = ["admin_action","listing_created","listing_listed","listing_updated","inquiry","favorite","login","brand_request_submitted","brand_request_decided","owner_link_changed"] as const
  export type ActivityKind = (typeof ACTIVITY_KINDS)[number]
  export interface ActivityItem { at: Date; kind: ActivityKind; id: string; actor: { id: string; name: string | null; email: string | null } | null; target: { type: string; id: string; label: string | null } | null; summary: string; source?: "ui" | "mcp" }
  export function encodeActivityCursor(c: { at: Date; kind: ActivityKind; id: string }): string
  export function decodeActivityCursor(cursor: string | null | undefined): { at: Date; kind: ActivityKind; id: string } | null
  export function summarizeActivity(row: ActivityRawRow): string
  export async function getRecentActivity(opts: { kinds?: ActivityKind[]; actorUserId?: string; since?: Date; cursor?: string | null; limit: number }): Promise<{ items: ActivityItem[]; nextCursor: string | null }>
  ```

- [ ] **Step 1: Write the failing test (pure parts)**

```ts
// src/__tests__/admin/activity.test.ts
import { describe, it, expect, vi } from "vitest"

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock("@/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }))

import {
  encodeActivityCursor,
  decodeActivityCursor,
  summarizeActivity,
  getRecentActivity,
  type ActivityRawRow,
} from "@/lib/admin/activity"

const at = new Date("2026-09-14T12:00:00.000Z")

describe("activity cursor", () => {
  it("round-trips", () => {
    const c = encodeActivityCursor({ at, kind: "inquiry", id: "c1" })
    expect(decodeActivityCursor(c)).toEqual({ at, kind: "inquiry", id: "c1" })
  })

  it("rejects garbage and unknown kinds", () => {
    expect(decodeActivityCursor("not-base64!")).toBeNull()
    expect(decodeActivityCursor(Buffer.from(JSON.stringify({ at: at.toISOString(), kind: "nope", id: "x" })).toString("base64url"))).toBeNull()
    expect(decodeActivityCursor(null)).toBeNull()
  })
})

function raw(over: Partial<ActivityRawRow>): ActivityRawRow {
  return {
    at,
    kind: "inquiry",
    id: "x",
    actor_id: "u1",
    actor_name: "Pat",
    actor_email: "pat@x.com",
    target_type: "listing",
    target_id: "l1",
    target_label: "Sugar House",
    detail: null,
    source: null,
    outcome: null,
    ...over,
  }
}

describe("summarizeActivity", () => {
  it("describes admin actions with verb, target and source", () => {
    expect(summarizeActivity(raw({ kind: "admin_action", detail: "listing.approve", source: "mcp", outcome: "ok" })))
      .toBe("Pat approved listing “Sugar House” via MCP")
  })
  it("marks failed admin actions", () => {
    expect(summarizeActivity(raw({ kind: "admin_action", detail: "user.remove", target_type: "user", target_label: "a@b.com", source: "ui", outcome: "error" })))
      .toBe("Pat removed user “a@b.com” (failed)")
  })
  it("falls back to email then 'Someone' for the actor", () => {
    expect(summarizeActivity(raw({ actor_name: null }))).toBe("pat@x.com inquired about “Sugar House”")
    expect(summarizeActivity(raw({ actor_name: null, actor_email: null }))).toBe("Someone inquired about “Sugar House”")
  })
  it("covers every kind", () => {
    expect(summarizeActivity(raw({ kind: "listing_created" }))).toBe("Pat created listing “Sugar House”")
    expect(summarizeActivity(raw({ kind: "listing_listed" }))).toBe("Listing “Sugar House” went live")
    expect(summarizeActivity(raw({ kind: "listing_updated" }))).toBe("Listing “Sugar House” was updated")
    expect(summarizeActivity(raw({ kind: "favorite" }))).toBe("Pat saved “Sugar House”")
    expect(summarizeActivity(raw({ kind: "login", target_type: "user", target_label: null }))).toBe("Pat signed in")
    expect(summarizeActivity(raw({ kind: "brand_request_submitted", target_type: "brand_request", target_label: "Wax Rivals" }))).toBe("Pat requested brand “Wax Rivals”")
    expect(summarizeActivity(raw({ kind: "brand_request_decided", target_type: "brand_request", target_label: "Wax Rivals", detail: "approved" }))).toBe("Pat approved brand request “Wax Rivals”")
    expect(summarizeActivity(raw({ kind: "owner_link_changed", target_type: "user", target_label: "o@x.com", detail: "manual" }))).toBe("Pat set owner link for “o@x.com” to manual")
  })
})

describe("getRecentActivity", () => {
  it("maps rows, trims to limit and returns a cursor when there is more", async () => {
    const rows = [1, 2, 3].map((n) => raw({ id: `c${n}`, at: new Date(at.getTime() - n * 1000) }))
    execute.mockResolvedValue({ rows })
    const out = await getRecentActivity({ limit: 2 })
    expect(out.items).toHaveLength(2)
    expect(out.items[0]).toMatchObject({ kind: "inquiry", id: "c1", actor: { id: "u1", name: "Pat", email: "pat@x.com" }, target: { type: "listing", id: "l1", label: "Sugar House" } })
    expect(decodeActivityCursor(out.nextCursor)).toEqual({ at: rows[1].at, kind: "inquiry", id: "c2" })
  })

  it("returns null cursor at the end", async () => {
    execute.mockResolvedValue({ rows: [raw({ id: "c1" })] })
    expect((await getRecentActivity({ limit: 25 })).nextCursor).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/admin/activity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `activity.ts`**

```ts
// src/lib/admin/activity.ts
/**
 * Admin activity feed: one time-ordered stream built from the audit log plus
 * the timestamps the app already records. Used by /admin/activity and the MCP
 * `list_recent_activity` tool.
 *
 * NOT a `"use server"` file. Does not check auth — callers do.
 *
 * Implementation note: a single UNION ALL over raw SQL. Every branch selects
 * the same 9 columns so Postgres can union them; timestamps are cast to
 * timestamptz because `listings`/`contacts`/... use `timestamp` while the
 * audit log and brand requests use `timestamptz`.
 */
import { sql, type SQL } from "drizzle-orm"
import { db } from "@/db"

export const ACTIVITY_KINDS = [
  "admin_action",
  "listing_created",
  "listing_listed",
  "listing_updated",
  "inquiry",
  "favorite",
  "login",
  "brand_request_submitted",
  "brand_request_decided",
  "owner_link_changed",
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export interface ActivityItem {
  at: Date
  kind: ActivityKind
  id: string
  actor: { id: string; name: string | null; email: string | null } | null
  target: { type: string; id: string; label: string | null } | null
  summary: string
  source?: "ui" | "mcp"
}

/** Shape of one row coming back from the UNION query. Exported for tests. */
export interface ActivityRawRow {
  at: Date | string
  kind: ActivityKind
  id: string
  actor_id: string | null
  actor_name: string | null
  actor_email: string | null
  target_type: string | null
  target_id: string | null
  target_label: string | null
  /** admin_action: the action name; brand_request_decided: status; owner_link_changed: source */
  detail: string | null
  source: "ui" | "mcp" | null
  outcome: "ok" | "error" | null
}

export interface ActivityCursor {
  at: Date
  kind: ActivityKind
  id: string
}

export function encodeActivityCursor(c: ActivityCursor): string {
  return Buffer.from(JSON.stringify({ at: c.at.toISOString(), kind: c.kind, id: c.id })).toString("base64url")
}

export function decodeActivityCursor(cursor: string | null | undefined): ActivityCursor | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      at?: unknown
      kind?: unknown
      id?: unknown
    }
    if (typeof parsed.at !== "string" || typeof parsed.id !== "string") return null
    if (!ACTIVITY_KINDS.includes(parsed.kind as ActivityKind)) return null
    const at = new Date(parsed.at)
    if (Number.isNaN(at.getTime())) return null
    return { at, kind: parsed.kind as ActivityKind, id: parsed.id }
  } catch {
    return null
  }
}

const ACTION_VERBS: Record<string, string> = {
  "listing.approve": "approved",
  "listing.reject": "rejected",
  "listing.update": "edited",
  "listing.mark_sold": "marked sold",
  "user.set_role": "changed role of",
  "user.set_seller_access": "changed seller access for",
  "user.remove": "removed",
  "allowlist.add": "allowlisted",
  "allowlist.remove": "removed from allowlist",
  "brand_request.approve": "approved",
  "brand_request.reject": "rejected",
  "brand_request.retry_dispatch": "retried dispatch for",
  "owner_link.add": "linked owner for",
  "owner_link.revoke": "revoked owner link for",
  "owner_link.clear": "cleared owner link for",
  "owner_directory.refresh": "refreshed",
  "listing_location.set_data_mapping": "set data mapping for",
  "mcp_token.revoke": "revoked MCP connection",
}

const TARGET_NOUNS: Record<string, string> = {
  listing: "listing",
  user: "user",
  allowlist: "allowlist entry",
  brand_request: "brand request",
  owner_link: "owner link",
  listing_location: "location",
  owner_directory: "owner directory",
  mcp_token: "MCP connection",
}

function quote(label: string | null): string {
  return label ? `“${label}”` : ""
}

function actorLabel(row: ActivityRawRow): string {
  return row.actor_name || row.actor_email || "Someone"
}

export function summarizeActivity(row: ActivityRawRow): string {
  const who = actorLabel(row)
  const label = quote(row.target_label)
  switch (row.kind) {
    case "admin_action": {
      const verb = ACTION_VERBS[row.detail ?? ""] ?? row.detail ?? "acted on"
      const noun = TARGET_NOUNS[row.target_type ?? ""] ?? ""
      const parts = [who, verb, noun, label].filter(Boolean).join(" ")
      const via = row.source === "mcp" ? " via MCP" : ""
      const failed = row.outcome === "error" ? " (failed)" : ""
      return `${parts}${via}${failed}`
    }
    case "listing_created":
      return `${who} created listing ${label}`.trim()
    case "listing_listed":
      return `Listing ${label} went live`
    case "listing_updated":
      return `Listing ${label} was updated`
    case "inquiry":
      return `${who} inquired about ${label}`.trim()
    case "favorite":
      return `${who} saved ${label}`.trim()
    case "login":
      return `${who} signed in`
    case "brand_request_submitted":
      return `${who} requested brand ${label}`.trim()
    case "brand_request_decided":
      return `${who} ${row.detail ?? "decided"} brand request ${label}`.trim()
    case "owner_link_changed":
      return `${who} set owner link for ${label} to ${row.detail ?? "unknown"}`
  }
}

const UNION_SQL = sql`
  SELECT a.created_at::timestamptz AS at, 'admin_action' AS kind, a.id AS id, a.actor_user_id AS actor_id,
         a.target_type AS target_type, a.target_id AS target_id, a.action AS detail, a.source AS source, a.outcome AS outcome
    FROM admin_audit_log a WHERE a.action <> 'mcp.read'
  UNION ALL
  SELECT l.created_at::timestamptz, 'listing_created', l.id, l.seller_id, 'listing', l.id, NULL, NULL, NULL FROM listings l
  UNION ALL
  SELECT l.listed_at::timestamptz, 'listing_listed', l.id, l.seller_id, 'listing', l.id, NULL, NULL, NULL FROM listings l WHERE l.listed_at IS NOT NULL
  UNION ALL
  SELECT l.updated_at::timestamptz, 'listing_updated', l.id, l.seller_id, 'listing', l.id, NULL, NULL, NULL FROM listings l WHERE l.updated_at <> l.created_at
  UNION ALL
  SELECT c.created_at::timestamptz, 'inquiry', c.id, c.buyer_id, 'listing', c.listing_id, NULL, NULL, NULL FROM contacts c
  UNION ALL
  SELECT f.created_at::timestamptz, 'favorite', f.id, f.user_id, 'listing', f.listing_id, NULL, NULL, NULL FROM favorites f
  UNION ALL
  SELECT e.created_at::timestamptz, 'login', e.id, e.user_id, 'user', e.user_id, NULL, NULL, NULL FROM login_events e
  UNION ALL
  SELECT b.created_at::timestamptz, 'brand_request_submitted', b.id, b.submitted_by, 'brand_request', b.id, NULL, NULL, NULL FROM brand_requests b
  UNION ALL
  SELECT b.decided_at::timestamptz, 'brand_request_decided', b.id, b.decided_by, 'brand_request', b.id, b.status, NULL, NULL FROM brand_requests b WHERE b.decided_at IS NOT NULL
  UNION ALL
  SELECT u.updated_at::timestamptz, 'owner_link_changed', u.id, u.actor_user_id, 'user', u.user_id, u.source, NULL, NULL FROM user_owner_links u
`

export async function getRecentActivity(opts: {
  kinds?: ActivityKind[]
  actorUserId?: string
  since?: Date
  cursor?: string | null
  limit: number
}): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit, 100))
  const where: SQL[] = [sql`ev.at IS NOT NULL`]

  if (opts.kinds && opts.kinds.length > 0) {
    const valid = opts.kinds.filter((k) => ACTIVITY_KINDS.includes(k))
    if (valid.length > 0) {
      where.push(sql`ev.kind IN (${sql.join(valid.map((k) => sql`${k}`), sql`, `)})`)
    }
  }
  if (opts.actorUserId) where.push(sql`ev.actor_id = ${opts.actorUserId}`)
  if (opts.since) where.push(sql`ev.at >= ${opts.since.toISOString()}::timestamptz`)

  const cursor = decodeActivityCursor(opts.cursor)
  if (cursor) {
    where.push(
      sql`(ev.at, ev.kind, ev.id) < (${cursor.at.toISOString()}::timestamptz, ${cursor.kind}, ${cursor.id})`,
    )
  }

  const query = sql`
    SELECT ev.at, ev.kind, ev.id, ev.actor_id,
           act.name AS actor_name, act.email AS actor_email,
           ev.target_type, ev.target_id,
           CASE ev.target_type
             WHEN 'listing' THEN tl.title
             WHEN 'user' THEN COALESCE(tu.name, tu.email)
             WHEN 'brand_request' THEN tb.brand_name
             ELSE ev.target_id
           END AS target_label,
           ev.detail, ev.source, ev.outcome
      FROM (${UNION_SQL}) ev
      LEFT JOIN users act ON act.id = ev.actor_id
      LEFT JOIN listings tl ON ev.target_type = 'listing' AND tl.id = ev.target_id
      LEFT JOIN users tu ON ev.target_type = 'user' AND tu.id = ev.target_id
      LEFT JOIN brand_requests tb ON ev.target_type = 'brand_request' AND tb.id = ev.target_id
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY ev.at DESC, ev.kind DESC, ev.id DESC
     LIMIT ${limit + 1}
  `

  const { rows } = (await db.execute(query)) as unknown as { rows: ActivityRawRow[] }
  const page = rows.slice(0, limit)
  const items: ActivityItem[] = page.map((r) => ({
    at: r.at instanceof Date ? r.at : new Date(r.at),
    kind: r.kind,
    id: r.id,
    actor: r.actor_id ? { id: r.actor_id, name: r.actor_name, email: r.actor_email } : null,
    target: r.target_type && r.target_id ? { type: r.target_type, id: r.target_id, label: r.target_label } : null,
    summary: summarizeActivity(r),
    ...(r.source ? { source: r.source } : {}),
  }))
  const last = items[items.length - 1]
  const nextCursor = rows.length > limit && last ? encodeActivityCursor({ at: last.at, kind: last.kind, id: last.id }) : null
  return { items, nextCursor }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/admin/activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Smoke the SQL against the local database**

Create a throwaway script in the scratchpad (not in the repo) or run inline:

```bash
DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" npx tsx -e "import('./src/lib/admin/activity').then(async m => { const r = await m.getRecentActivity({ limit: 5 }); console.log(JSON.stringify(r, null, 2)); process.exit(0) })"
```

Expected: JSON with up to 5 items and no SQL error. If `tsx` crashes on `server-only` (see memory note "scripts can't import server-only"), the import chain of `activity.ts` must be fixed so it does not transitively import a `server-only` module — `@/db` does not, so this should pass. Note the migration 0011 must have been applied locally first (`npm run db:migrate` against your local/branch DB) or the `admin_audit_log` branch will error.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/lib/admin/activity.ts src/__tests__/admin/activity.test.ts
git commit -m "feat(admin): unified activity feed query with keyset cursor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `/admin/activity` page and nav entry

**Files:**
- Create: `src/app/admin/activity/page.tsx`
- Modify: `src/lib/navigation.ts` (`ADMIN_NAV`)
- Modify: `src/__tests__/navigation.test.ts` (if it asserts the admin nav list)

**Interfaces:**
- Consumes: `getRecentActivity`, `ACTIVITY_KINDS`, `getUsers` (core).

- [ ] **Step 1: Update the nav test expectation**

Open `src/__tests__/navigation.test.ts`. If any assertion lists the admin nav labels/hrefs, add `{ label: "Activity", href: "/admin/activity" }` between "Analytics" and "Data" in the expected array. Run `npx vitest run src/__tests__/navigation.test.ts` → FAIL (expected, until Step 2).

- [ ] **Step 2: Add the nav entry**

In `src/lib/navigation.ts`, `ADMIN_NAV`, insert after the Analytics line:

```ts
  { label: "Activity", href: "/admin/activity" },
```

Run: `npx vitest run src/__tests__/navigation.test.ts` → PASS.

- [ ] **Step 3: Create the page**

```tsx
// src/app/admin/activity/page.tsx
import Link from "next/link"
import { requireAdmin } from "@/lib/auth-guards"
import { getRecentActivity, ACTIVITY_KINDS, type ActivityKind } from "@/lib/admin/activity"
import { getUsers } from "@/lib/admin/core/users"

export const metadata = { title: "Activity - Admin" }

// The audit log and brand requests change out of band; never cache this page.
export const dynamic = "force-dynamic"

const KIND_LABELS: Record<ActivityKind, string> = {
  admin_action: "Admin actions",
  listing_created: "Listings created",
  listing_listed: "Listings went live",
  listing_updated: "Listings updated",
  inquiry: "Inquiries",
  favorite: "Saves",
  login: "Logins",
  brand_request_submitted: "Brand requests",
  brand_request_decided: "Brand decisions",
  owner_link_changed: "Owner links",
}

function parseKind(value: string | undefined): ActivityKind | undefined {
  return ACTIVITY_KINDS.includes(value as ActivityKind) ? (value as ActivityKind) : undefined
}

function targetHref(target: { type: string; id: string } | null): string | null {
  if (!target) return null
  switch (target.type) {
    case "listing":
      return `/admin/listings/${target.id}`
    case "user":
      return `/admin/analytics/${target.id}`
    case "brand_request":
      return `/admin/brand-requests/${target.id}`
    default:
      return null
  }
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; actor?: string; cursor?: string }>
}) {
  // Admin access is enforced by src/app/admin/layout.tsx and again here.
  await requireAdmin()

  const { kind, actor, cursor } = await searchParams
  const kindFilter = parseKind(kind)
  const actorFilter = actor || undefined

  const [{ items, nextCursor }, users] = await Promise.all([
    getRecentActivity({
      kinds: kindFilter ? [kindFilter] : undefined,
      actorUserId: actorFilter,
      cursor: cursor ?? null,
      limit: 50,
    }),
    getUsers(),
  ])

  const olderParams = new URLSearchParams()
  if (kindFilter) olderParams.set("kind", kindFilter)
  if (actorFilter) olderParams.set("actor", actorFilter)
  if (nextCursor) olderParams.set("cursor", nextCursor)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <h1 className="font-display text-2xl font-bold text-gray-900">Activity</h1>
        <span className="text-sm text-gray-500">Newest first</span>
      </div>

      <form method="get" className="flex flex-wrap gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Kind
          <select name="kind" defaultValue={kindFilter ?? ""} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">All</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Actor
          <select name="actor" defaultValue={actorFilter ?? ""} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email || u.id}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white">
          Filter
        </button>
        <Link href="/admin/activity" className="self-center text-sm text-gray-500 underline">
          Reset
        </Link>
      </form>

      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          No activity matches these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">When</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Kind</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">What happened</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {items.map((item) => {
                  const href = targetHref(item.target)
                  return (
                    <tr key={`${item.kind}-${item.id}`} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                        {item.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-700">{KIND_LABELS[item.kind]}</td>
                      <td className="px-6 py-3 text-sm text-gray-900">
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {item.summary}
                          </Link>
                        ) : (
                          item.summary
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">{item.source === "mcp" ? "MCP" : item.source === "ui" ? "Web" : "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-end">
          <Link href={`/admin/activity?${olderParams.toString()}`} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
            Older →
          </Link>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/app/admin/activity src/lib/navigation.ts`
Expected: clean. (Component tests are impossible in this vitest setup; the page is verified live in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/activity/page.tsx src/lib/navigation.ts src/__tests__/navigation.test.ts
git commit -m "feat(admin): /admin/activity feed page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Full gates, live check, PR

**Files:** none new.

- [ ] **Step 1: Run every gate**

```bash
npx tsc --noEmit
npx eslint .
npm test
```

Expected: all clean; the full vitest suite passes including every pre-existing admin-action test.

- [ ] **Step 2: Apply migration 0011 to the local/branch database**

From the main checkout with `.env.local` present:

```bash
npm run db:migrate
```

Expected: `Migrations complete`, and `admin_audit_log` exists (`psql`/Neon console: `\d admin_audit_log`, or `npm run db:studio`).

- [ ] **Step 3: Live check (only when the user has asked for the dev server, otherwise ask)**

With `npm run dev` running (ask the user to start it — do not auto-start):
1. Sign in as an admin, open `/admin/users`, toggle seller access on a test user.
2. Open `/admin/activity` — the first row reads "… changed seller access for user … " with Source "Web".
3. Filter by Kind = "Admin actions" and by that admin — the row remains; Reset clears.
4. Query `select action, source, outcome, args from admin_audit_log order by created_at desc limit 3;` — one `user.set_seller_access` row, `outcome = 'ok'`, args `{"userId":..., "sellerAccess":...}`.

- [ ] **Step 4: Push and open the PR against `main`**

```bash
git push -u origin feature/admin-mcp-server
gh pr create --base main --title "feat(admin): audited core admin modules + activity feed (MCP PR A)" --body "$(cat <<'EOF'
## Summary
- Extract every admin mutation into actor-first core modules under `src/lib/admin/core/` (listings, users, allowlist, brand requests, owner links, owner directory, data mappings) and turn the `"use server"` actions into `requireAdmin()` wrappers. UI call sites unchanged.
- New `admin_audit_log` table (migration 0011) written by `withAudit` for every admin mutation, UI or MCP; `{ ok:false }` results and thrown errors both log `outcome = 'error'`.
- New `/admin/activity` feed (audit log ∪ listings ∪ inquiries ∪ saves ∪ logins ∪ brand requests ∪ owner links) with kind/actor filters and keyset pagination.
- `setLocationMapping` now uses `requireAdmin()` like every other admin action.

Spec: `docs/superpowers/specs/2026-09-14-admin-mcp-server-design.md` (PR A of 3). Plan: `docs/superpowers/plans/2026-09-14-admin-mcp-server-a-core-audit.md`.

## Migration
`drizzle/0011_admin_audit_log.sql` — apply with `npm run db:migrate` before promoting.

## Test plan
- [x] `npx tsc --noEmit`, `npx eslint .`, `npm test`
- [ ] Live: admin action in the UI appears on `/admin/activity` with Source "Web" and a matching `admin_audit_log` row

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `git push` returns 403, switch accounts with `gh auth switch` (only `sugarparker` can push to this repo) and retry.

---

## Self-Review Notes

- **Spec §5 coverage:** every module in the spec's table has a task (3–8); actor type and thin-wrapper pattern in Tasks 2–8; `setLocationMapping` guard normalized in Task 7; "NOT a use server" headers on every core module.
- **Spec §6 coverage:** table/indexes/migration (Task 1), `withAudit` semantics incl. redaction, error swallow, `{ok:false}` → error (Task 2), `recordMcpRead` (Task 2), union feed with the exact kinds and cursor (Task 9), `/admin/activity` page with filters and nav (Task 10).
- **Spec §8 coverage:** existing admin-action tests pass unchanged in behavior (mock added), new tests hit core functions with a UI and an MCP actor and assert audit calls; feed ordering/cursor tested; live check in Task 11.
- **Type consistency:** `withAudit` returns `{ result, auditId }` everywhere; all mutations return `{ ...result, auditId }`; `uiActorFromSession` is the only session→actor path; target type strings match `AUDIT_TARGET_TYPES`.
