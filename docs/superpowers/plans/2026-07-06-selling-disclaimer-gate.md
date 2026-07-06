# Selling-Franchise Disclaimer Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "Selling Your Franchise" disclaimer interstitial before the add-listing wizard at `/seller/listings/new`; the seller must acknowledge (checkbox) to unlock the form, and each acknowledgment is recorded (timestamp + FDD version).

**Architecture:** A client gate component renders the static disclaimer + an acknowledgment checkbox; on Continue it calls a server action that inserts an audit row, and on success swaps itself for the existing `ListingWizard`. A new append-only table stores acknowledgments, created via a hand-authored migration.

**Tech Stack:** Next.js (App Router, client + server components, server actions), TypeScript, Drizzle ORM (Neon HTTP), hand-authored SQL migration + `db:migrate`, Vitest (node env), Tailwind (`hs-red` palette).

## Global Constraints

- **This is NOT the Next.js you know** — read `node_modules/next/dist/docs/` before writing framework code; heed deprecation notices (`AGENTS.md`).
- **DO NOT run `npm run db:push`.** This branch is cut from `main` and its schema lacks the `owner_locations` coordinate columns that already exist on the live DB (in-flight map feature). A whole-schema `db:push` would try to DROP them. Create the new table with a **hand-authored migration + `npm run db:migrate`** (uses `DATABASE_URL_DIRECT` from `.env.local`).
- **Test env is `node`-only** (vitest, `src/__tests__/**/*.test.ts`). Unit-test pure logic + server actions (mock `@/auth` and `@/db`, per `src/__tests__/admin.test.ts`). React components + rendering are gated by `npx tsc --noEmit` + manual, never unit tests.
- **No `next build`** (Windows `.next` lock); **no `npm run lint`** (pre-existing broken). Never start the dev server. Per-step gate is `npx tsc --noEmit`.
- **`FDD_VERSION = "2026"`** — single source of truth for the recorded version.
- **Copy is verbatim** from the spec: fee amounts stay as "per your Franchise Agreement / 2026 FDD"; broker fee "$30,000 flat or 10% of the final sale price"; wire note "All fees must be wired to Hello Sugar 3 business days prior to close."; the reworked close (reversible listing / permanent sale); and the acknowledgment label: "I have read and understand the fee structure, and I understand that while I can remove my listing at any time, a completed sale is permanent."
- **Gate scope:** `/seller/listings/new` only. Do NOT touch the edit flow (`/seller/listings/[id]/edit`).

---

### Task 1: New audit table + hand-authored `0004` migration

**Files:**
- Create: `src/db/schema/disclaimerAcknowledgments.ts`
- Modify: `src/db/schema.ts`
- Create: `drizzle/0004_listing_disclaimer_acknowledgments.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0004_snapshot.json`

**Interfaces:**
- Consumes: `users` from `./auth`.
- Produces: `listingDisclaimerAcknowledgments` table + `ListingDisclaimerAcknowledgment` / `NewListingDisclaimerAcknowledgment` types, exported from `@/db/schema`. Columns: `id` (text pk), `userId` (text, FK users.id cascade), `fddVersion` (text notNull), `acknowledgedAt` (timestamp default now notNull).

- [ ] **Step 1: Pre-flight — confirm the migration chain is currently clean**

Run: `npm run db:migrate`
Expected: prints `Running migrations...` then `Migrations complete`, exit 0, **no error**. (Confirms `0000`–`0003` are already recorded as applied and the DB is a clean no-op before we add `0004`.)
**STOP** and escalate if it errors (e.g., "relation already exists") — the migration state is inconsistent and hand-adding `0004` is unsafe until reconciled.

- [ ] **Step 2: Create the schema file**

Create `src/db/schema/disclaimerAcknowledgments.ts` (modeled on `src/db/schema/loginEvents.ts`):

```ts
import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

// One row per time a seller acknowledges the "Selling Your Franchise" disclaimer
// on the add-listing gate. Append-only audit log (timestamp + FDD version).
// The acknowledgment happens before any listing exists, so it ties to the user.
export const listingDisclaimerAcknowledgments = pgTable(
  "listing_disclaimer_acknowledgments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fddVersion: text("fdd_version").notNull(),
    acknowledgedAt: timestamp("acknowledged_at").defaultNow().notNull(),
  },
  (table) => [
    index("listing_disclaimer_ack_user_id_idx").on(table.userId),
  ],
)

export const listingDisclaimerAcknowledgmentsRelations = relations(
  listingDisclaimerAcknowledgments,
  ({ one }) => ({
    user: one(users, {
      fields: [listingDisclaimerAcknowledgments.userId],
      references: [users.id],
    }),
  }),
)

export type ListingDisclaimerAcknowledgment = typeof listingDisclaimerAcknowledgments.$inferSelect
export type NewListingDisclaimerAcknowledgment = typeof listingDisclaimerAcknowledgments.$inferInsert
```

- [ ] **Step 3: Export it from the schema barrel**

In `src/db/schema.ts`, add after the last `export * from "./schema/..."` line:

```ts
export * from "./schema/disclaimerAcknowledgments"
```

- [ ] **Step 4: Typecheck the schema**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Hand-author the migration SQL**

Create `drizzle/0004_listing_disclaimer_acknowledgments.sql` (Drizzle style, mirroring `drizzle/0003_saved_competitors.sql` — quoted idents, `--> statement-breakpoint`, guarded FK, `"public"."users"`):

```sql
CREATE TABLE "listing_disclaimer_acknowledgments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"fdd_version" text NOT NULL,
	"acknowledged_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_disclaimer_acknowledgments" ADD CONSTRAINT "listing_disclaimer_acknowledgments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "listing_disclaimer_ack_user_id_idx" ON "listing_disclaimer_acknowledgments" USING btree ("user_id");
```

- [ ] **Step 6: Append the journal entry**

In `drizzle/meta/_journal.json`, add a fourth object to the `entries` array (after the `0003_saved_competitors` entry). The `when` must be greater than the last entry's (`1782460262463`):

```json
    {
      "idx": 4,
      "version": "7",
      "when": 1783600000000,
      "tag": "0004_listing_disclaimer_acknowledgments",
      "breakpoints": true
    }
```

(Insert a comma after the `0003` entry's closing brace so the array stays valid JSON.)

- [ ] **Step 7: Generate the `0004` snapshot (scripted, deterministic)**

Run this to clone the `0003` snapshot, relink it, and insert the new table entry (keeps the meta chain coherent; the migrator applies from SQL+journal and does not require this, but the documented pattern includes it):

```bash
python -c "
import json, uuid
snap = json.load(open('drizzle/meta/0003_snapshot.json'))
snap['prevId'] = snap['id']
snap['id'] = str(uuid.uuid4())
snap['tables']['public.listing_disclaimer_acknowledgments'] = {
  'name': 'listing_disclaimer_acknowledgments',
  'schema': '',
  'columns': {
    'id': {'name':'id','type':'text','primaryKey':True,'notNull':True},
    'user_id': {'name':'user_id','type':'text','primaryKey':False,'notNull':True},
    'fdd_version': {'name':'fdd_version','type':'text','primaryKey':False,'notNull':True},
    'acknowledged_at': {'name':'acknowledged_at','type':'timestamp','primaryKey':False,'notNull':True,'default':'now()'},
  },
  'indexes': {
    'listing_disclaimer_ack_user_id_idx': {
      'name':'listing_disclaimer_ack_user_id_idx',
      'columns':[{'expression':'user_id','isExpression':False,'asc':True,'nulls':'last'}],
      'isUnique':False,'concurrently':False,'method':'btree','with':{}
    }
  },
  'foreignKeys': {
    'listing_disclaimer_acknowledgments_user_id_users_id_fk': {
      'name':'listing_disclaimer_acknowledgments_user_id_users_id_fk',
      'tableFrom':'listing_disclaimer_acknowledgments','tableTo':'users',
      'columnsFrom':['user_id'],'columnsTo':['id'],
      'onDelete':'cascade','onUpdate':'no action'
    }
  },
  'compositePrimaryKeys': {}, 'uniqueConstraints': {}, 'policies': {},
  'checkConstraints': {}, 'isRLSEnabled': False
}
json.dump(snap, open('drizzle/meta/0004_snapshot.json','w'), indent=2)
print('wrote drizzle/meta/0004_snapshot.json')
"
```
Expected: `wrote drizzle/meta/0004_snapshot.json`.

- [ ] **Step 8: Apply the migration**

Run: `npm run db:migrate`
Expected: `Running migrations...` → `Migrations complete`, exit 0, no error (applies only `0004`).

- [ ] **Step 9: Verify the table exists on the live DB**

Run:
```bash
npx tsx -e 'import {neon} from "@neondatabase/serverless"; import {config} from "dotenv"; config({path:".env.local"}); neon(process.env.DATABASE_URL_DIRECT!)("select count(*)::int as n from listing_disclaimer_acknowledgments").then(r=>{console.log("table OK, rows =", r[0].n); process.exit(0)}).catch(e=>{console.error("MISSING:", e.message); process.exit(1)})'
```
Expected: `table OK, rows = 0`.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/disclaimerAcknowledgments.ts src/db/schema.ts drizzle/0004_listing_disclaimer_acknowledgments.sql drizzle/meta/_journal.json drizzle/meta/0004_snapshot.json
git commit -m "feat(db): add listing_disclaimer_acknowledgments table (0004 migration)"
```

---

### Task 2: Server action + FDD version constant

**Files:**
- Create: `src/lib/listings/disclaimer-actions.ts`
- Test: `src/__tests__/disclaimer-actions.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/auth`; `db` from `@/db`; `listingDisclaimerAcknowledgments` from `@/db/schema` (Task 1).
- Produces: `FDD_VERSION` (string `"2026"`); `acknowledgeSellingDisclaimer(): Promise<{ ok: true }>` — auth-guarded, inserts one audit row, throws on unauthenticated or DB error.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/disclaimer-actions.test.ts` (mirrors the mock style of `src/__tests__/admin.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockAuth, mockInsert, valuesCalls, valuesImpl } = vi.hoisted(() => {
  const valuesCalls: Record<string, unknown>[] = []
  const valuesImpl = { current: (_v: Record<string, unknown>) => Promise.resolve() as Promise<unknown> }
  return {
    mockAuth: vi.fn(),
    valuesCalls,
    valuesImpl,
    mockInsert: vi.fn(() => ({
      values: (v: Record<string, unknown>) => {
        valuesCalls.push(v)
        return valuesImpl.current(v)
      },
    })),
  }
})

vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/db", () => ({ db: { insert: mockInsert } }))

import { acknowledgeSellingDisclaimer, FDD_VERSION } from "@/lib/listings/disclaimer-actions"

beforeEach(() => {
  vi.clearAllMocks()
  valuesCalls.length = 0
  valuesImpl.current = () => Promise.resolve()
})

describe("FDD_VERSION", () => {
  it("is the expected version string", () => {
    expect(FDD_VERSION).toBe("2026")
  })
})

describe("acknowledgeSellingDisclaimer", () => {
  it("inserts one row for the authenticated user and returns ok", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    const result = await acknowledgeSellingDisclaimer()
    expect(result).toEqual({ ok: true })
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(valuesCalls).toHaveLength(1)
    expect(valuesCalls[0]).toMatchObject({ userId: "user-1", fddVersion: "2026" })
  })

  it("throws and does not insert when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(acknowledgeSellingDisclaimer()).rejects.toThrow()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it("propagates a DB insert error (so the caller can withhold the wizard)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } })
    valuesImpl.current = () => Promise.reject(new Error("db down"))
    await expect(acknowledgeSellingDisclaimer()).rejects.toThrow("db down")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- disclaimer-actions`
Expected: FAIL — cannot resolve `@/lib/listings/disclaimer-actions`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/listings/disclaimer-actions.ts`:

```ts
"use server"

import { auth } from "@/auth"
import { db } from "@/db"
import { listingDisclaimerAcknowledgments } from "@/db/schema"

// Version of the disclaimer/FDD the seller is acknowledging. Bump deliberately
// when the fee terms change so the audit log records which version applied.
export const FDD_VERSION = "2026"

/**
 * Record that the current seller acknowledged the "Selling Your Franchise"
 * disclaimer on the add-listing gate. One append-only audit row per call.
 *
 * Requires an authenticated session (same bar as the /seller/listings/new page;
 * NOT the stricter sellerAccess check — the listing-creation actions enforce
 * that downstream). Throws on no session or DB error so the gate can withhold
 * the wizard until the acknowledgment is durably recorded.
 */
export async function acknowledgeSellingDisclaimer(): Promise<{ ok: true }> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error("Not authenticated")
  }

  await db.insert(listingDisclaimerAcknowledgments).values({
    userId: session.user.id,
    fddVersion: FDD_VERSION,
  })

  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- disclaimer-actions`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/lib/listings/disclaimer-actions.ts src/__tests__/disclaimer-actions.test.ts
git commit -m "feat: acknowledgeSellingDisclaimer server action + FDD_VERSION"
```

---

### Task 3: Disclaimer content component

**Files:**
- Create: `src/components/listings/SellingDisclaimer.tsx`

**Interfaces:**
- Consumes: nothing (static, presentational; no props).
- Produces: `SellingDisclaimer` component — the approved Option A content (basics, fee structure A/B, reworked reversible/permanent close).

> No unit test (presentational, node-only test env has no DOM harness). Gate: `npx tsc --noEmit`. Verified visually in Task 5.

- [ ] **Step 1: Create the component**

Create `src/components/listings/SellingDisclaimer.tsx` (Tailwind, `hs-red` for brand, amber for informational warmth, emerald for the reversible pane — all copy verbatim):

```tsx
// Static "Selling Your Franchise" disclaimer content shown on the add-listing
// gate. Copy is intentionally hardcoded (legal text). Fee amounts reference the
// Franchise Agreement / 2026 FDD rather than stating figures.
export function SellingDisclaimer() {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Selling Your Franchise</h2>
      <p className="mt-1 text-sm text-gray-500">
        Before you begin, here&apos;s what you should know about the resale process.
      </p>

      {/* The basics */}
      <h3 className="mt-6 text-[11px] font-bold uppercase tracking-wider text-amber-700">The basics</h3>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-amber-50 p-4">
          <div className="text-sm font-semibold text-gray-900">⏱ How long does it take?</div>
          <p className="mt-1 text-sm text-gray-700 leading-relaxed">
            Selling a Hello Sugar can take anywhere from <strong>1–18 months</strong>. The health of your
            business, financing options, and market conditions all affect timing.
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4">
          <div className="text-sm font-semibold text-gray-900">💰 What&apos;s it worth?</div>
          <p className="mt-1 text-sm text-gray-700 leading-relaxed">
            Profitable businesses typically sell at a <strong>3–5× multiple of earnings</strong>. Unprofitable
            locations are generally valued based on equipment, outstanding liabilities, and lease assumption.
          </p>
        </div>
      </div>

      {/* Fee structure */}
      <h3 className="mt-6 text-[11px] font-bold uppercase tracking-wider text-amber-700">Fee structure</h3>
      <p className="text-sm text-gray-500">Review all applicable fees before submitting your inquiry.</p>

      <div className="mt-3 rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-900">Option A — Self-Managed Sale</div>
        <p className="mt-0.5 text-sm text-gray-500">
          You find your own buyer. Hello Sugar is not involved in the transaction beyond approving the transfer.
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li>Transfer Fee (per your Franchise Agreement / 2026 FDD)</li>
          <li>Fee Deposit (per your Franchise Agreement)</li>
          <li>Your own legal fees for the transaction</li>
        </ul>
      </div>

      <div className="mt-3 rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-900">Option B — Hello Sugar-Managed Sale</div>
        <p className="mt-0.5 text-sm text-gray-500">
          Ana and the Hello Sugar team manage the sale process on your behalf — finding a buyer, coordinating
          diligence, and facilitating the transaction.
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li>Transfer Fee (per your Franchise Agreement / 2026 FDD)</li>
          <li>Resale Assistance Fee (per your Franchise Agreement / 2026 FDD)</li>
        </ul>
        <div className="mt-3 rounded-lg border border-dashed border-amber-400 bg-amber-50/60 p-3 text-sm text-gray-700 leading-relaxed">
          <strong>Broker Fees (if applicable)</strong> — If a broker is involved, a fee of{" "}
          <strong>$30,000 flat or 10% of the final sale price</strong> (whichever applies) is the seller&apos;s
          responsibility.
        </div>
      </div>

      <p className="mt-3 text-sm italic text-gray-500">
        All fees must be wired to Hello Sugar 3 business days prior to close.
      </p>

      {/* Reworked close: reversible listing vs permanent sale */}
      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200">
        <div className="px-4 pt-4 pb-1 text-sm font-bold text-gray-900">
          Listing is reversible — only a completed sale is permanent
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <div className="bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-800">
            <div className="font-bold">✓ Listing commits you to nothing</div>
            Change your mind, or don&apos;t get an offer you love? You can remove your listing at any time before
            a sale closes — no penalty, no obligation.
          </div>
          <div className="bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 sm:border-l border-amber-100">
            <div className="font-bold">⚠️ A completed sale is permanent</div>
            Once a transfer closes, you&apos;ll no longer be a Hello Sugar franchisee. Please be sure before you
            finalize a transaction.
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expect no errors), then:

```bash
git add src/components/listings/SellingDisclaimer.tsx
git commit -m "feat: SellingDisclaimer content component"
```

---

### Task 4: Gate component + page wiring

**Files:**
- Create: `src/components/listings/ListingDisclaimerGate.tsx`
- Modify: `src/app/seller/listings/new/page.tsx`

**Interfaces:**
- Consumes: `SellingDisclaimer` from `./SellingDisclaimer` (Task 3); `acknowledgeSellingDisclaimer` from `@/lib/listings/disclaimer-actions` (Task 2); `ListingWizard` from `./ListingWizard` (existing).
- Produces: `ListingDisclaimerGate` component, props `{ userId: string }` — shows the disclaimer + acknowledgment gate; reveals `<ListingWizard userId={userId} />` only after a successful acknowledgment.

> No unit test (client component, node-only test env). Gate: `npx tsc --noEmit` + full suite. Verified in Task 5.

- [ ] **Step 1: Create the gate component**

Create `src/components/listings/ListingDisclaimerGate.tsx`:

```tsx
"use client"

import { useState } from "react"
import { SellingDisclaimer } from "./SellingDisclaimer"
import { ListingWizard } from "./ListingWizard"
import { acknowledgeSellingDisclaimer } from "@/lib/listings/disclaimer-actions"

interface ListingDisclaimerGateProps {
  userId: string
}

export function ListingDisclaimerGate({ userId }: ListingDisclaimerGateProps) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Once acknowledged (and recorded server-side), the wizard replaces the gate.
  if (acknowledged) {
    return <ListingWizard userId={userId} />
  }

  const handleContinue = async () => {
    if (!checked || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await acknowledgeSellingDisclaimer()
      setAcknowledged(true)
    } catch {
      // Record-to-proceed: hold the seller on the gate so we always capture the
      // acknowledgment before the form opens. The box stays checked for retry.
      setError("Something went wrong recording your acknowledgment. Please try again.")
      setSubmitting(false)
    }
  }

  return (
    <div>
      <SellingDisclaimer />

      <label className="mt-6 flex items-start gap-3 rounded-xl border border-gray-200 p-4 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] accent-hs-red-600"
        />
        <span className="text-sm text-gray-800 leading-relaxed">
          I have read and understand the fee structure, and I understand that while I can remove my listing at
          any time, <strong>a completed sale is permanent</strong>.
        </span>
      </label>

      {error && (
        <div role="alert" className="mt-4 p-3 bg-hs-red-50 border border-hs-red-200 rounded-lg text-sm text-hs-red-700">
          {error}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!checked || submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-hs-red-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-hs-red-700 disabled:cursor-not-allowed disabled:bg-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
        >
          {submitting ? "Saving…" : "Continue to Form →"}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the gate into the page**

In `src/app/seller/listings/new/page.tsx`, replace the `ListingWizard` import and usage with the gate. Change the import line:

```ts
import { ListingDisclaimerGate } from '@/components/listings/ListingDisclaimerGate'
```

and the render (inside the card `<div>`):

```tsx
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
        <ListingDisclaimerGate userId={session.user.id} />
      </div>
```

(The `ListingWizard` import is now unused in this file — remove it.)

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit`
Expected: no errors (no unused-import error from the removed `ListingWizard` import).

Run: `npm test`
Expected: full suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/listings/ListingDisclaimerGate.tsx src/app/seller/listings/new/page.tsx
git commit -m "feat(listings): gate add-listing form behind Selling Your Franchise disclaimer"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full gate**

Run: `npm test` (expect all suites pass) and `npx tsc --noEmit` (expect no errors).

- [ ] **Step 2: Manual smoke (ask the user to start the dev server — do NOT auto-start)**

On `/seller/listings/new`, confirm:
- The disclaimer shows before the wizard; timing/valuation, Option A/B fees, broker terms, and wire note render with the exact copy.
- The close reads as reversible-listing / permanent-sale (green + amber panes), not alarmist.
- **Continue to Form** is disabled until the acknowledgment box is checked.
- Checking the box + Continue reveals the 3-step wizard; a new row appears in `listing_disclaimer_acknowledgments` (userId + `fdd_version = '2026'` + timestamp).
- Reloading `/new` shows the disclaimer again (no suppression).
- The edit flow (`/seller/listings/[id]/edit`) shows **no** gate.

- [ ] **Step 3: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to push and open a PR against `main`.

---

## Self-Review

**Spec coverage:**
- Full-page interstitial before the wizard → Task 4 (gate) + Task 3 (content). ✓
- Reworked reversible/permanent messaging + checkbox wording → Task 3 + Task 4. ✓
- Record acknowledgment (timestamp + FDD version), record-to-proceed → Task 1 (table) + Task 2 (action) + Task 4 (withhold wizard on error). ✓
- Shown every visit; not on edit → Task 4 (local state, no persistence; only `new/page.tsx` changed). ✓
- Auth guard = authenticated session (not sellerAccess) → Task 2. ✓
- Hand-authored `0004` migration, NOT `db:push` → Task 1 + Global Constraints. ✓
- Copy verbatim / `FDD_VERSION = "2026"` → Global Constraints + Tasks 2, 3. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. ✓

**Type consistency:** `listingDisclaimerAcknowledgments` (Task 1) imported by Task 2; `acknowledgeSellingDisclaimer` / `FDD_VERSION` (Task 2) consumed by Task 4's gate and Task 2's test; `SellingDisclaimer` (Task 3) and `ListingWizard` (existing) consumed by Task 4; gate prop `{ userId: string }` matches the page's `session.user.id`. Column names (`user_id`, `fdd_version`, `acknowledged_at`) identical across the schema, SQL, and snapshot. ✓
