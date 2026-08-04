# Competitor Closure Detected Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "Closure detected Jun 22, 2026" on every competitor closure card — the `/browse` list, the map popup, and the `/account/favorites` saved cards — from one shared formatter.

**Architecture:** A single pure formatter in `src/lib/closure-recency.ts` returns either the full display sentence or `null`, and each of the three render sites omits the line when it gets `null`. The `/browse` list and map popup already receive `closedAt`, so they are display-only changes. The favorites page reads from `saved_competitors`, which snapshots display fields and has no date column, so that surface additionally needs migration `0010`, a schema field, a mapping in the snapshot funnel, and defensive parsing in the server action.

**Tech Stack:** Next.js App Router (React 19), TypeScript, Drizzle ORM on Neon Postgres (neon-http driver), Tailwind v4 with a brand `@theme`, vitest (node environment), MapTiler SDK.

## Global Constraints

- **Copy is exactly `Closure detected <Mon D, YYYY>`** — e.g. `Closure detected Jun 22, 2026`. Never "Closed on": `closed_at` is when the scraper first *detected* the closure, not when the business closed.
- **Date format is `en-US` with `{ year: "numeric", month: "short", day: "numeric" }`**, pinned to **`timeZone: "America/Denver"`**. The fixed zone is mandatory — it is what makes one formatter produce byte-identical output on the server and the client, so there is no hydration mismatch.
- **A missing or unparseable date renders no line at all.** 22 of 79 production rows have no `closed_at`; never substitute a placeholder, a fallback date, or an empty element.
- **`competitor_opportunities` is strictly read-only from this app.** No INSERT/UPDATE/DELETE, no schema change, no foreign key into it. The external Railway `competitor-monitor` scraper owns every row and its columns are a byte-for-byte shared contract.
- **`drizzle-kit generate` is broken in this repo** (snapshot drift). The migration SQL, its `drizzle/meta/_journal.json` entry, **and** its `drizzle/meta/NNNN_snapshot.json` are all hand-authored. Never run `npm run db:generate`.
- **Do not run `next build` while a dev server is running** (Windows `.next` lock). Use `npx tsc --noEmit` as the per-task type gate.
- **Never start `npm run dev` unprompted.** Manual browser verification steps say to ask the user to start it.
- Tailwind's stock palette names are remapped to brand colors in this repo's `@theme`. `text-hs-mauve` and `text-hs-taupe` are the intended brand tokens here — do not "correct" them.

---

### Task 1: Shared `formatClosureDetected` formatter

The one source of truth for the copy and the date format. Every later task calls this.

**Files:**
- Modify: `src/lib/closure-recency.ts` (append; currently ends at line 38)
- Test: `src/__tests__/closure-recency.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `formatClosureDetected(closedAt: string | Date | null): string | null`
  - `CLOSURE_DETECTED_TIMEZONE: string` (the literal `"America/Denver"`)

  The parameter accepts `Date` as well as `string` because the two callers differ: the browse list and map popup hold an ISO `string` (serialized by `competitor-query.ts`), while the favorites page holds a `Date` straight from the Drizzle driver. Widening the input here keeps a `.toISOString()` dance and a second null check out of the server component.

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/closure-recency.test.ts`:

```ts
describe("formatClosureDetected", () => {
  it("formats a detection timestamp as the approved sentence", () => {
    // 18:00Z on Jun 22 is midday Jun 22 in Denver — pins the exact copy+format.
    expect(formatClosureDetected("2026-06-22T18:00:00.000Z")).toBe(
      "Closure detected Jun 22, 2026"
    )
  })

  it("formats in America/Denver, not UTC", () => {
    // A real production value. 04:44Z on Jun 22 is 22:44 on Jun 21 in Denver,
    // so a UTC-based implementation would say "Jun 22" and fail here.
    expect(formatClosureDetected("2026-06-22T04:44:29.680Z")).toBe(
      "Closure detected Jun 21, 2026"
    )
  })

  it("accepts a Date as well as an ISO string", () => {
    // The favorites page gets a Date from the Drizzle driver.
    expect(formatClosureDetected(new Date("2026-06-22T18:00:00.000Z"))).toBe(
      "Closure detected Jun 22, 2026"
    )
  })

  it("returns null for a null date so the caller omits the line", () => {
    // 22 of 79 production rows have no closed_at.
    expect(formatClosureDetected(null)).toBeNull()
  })

  it("returns null for an empty string", () => {
    expect(formatClosureDetected("")).toBeNull()
  })

  it("returns null for an unparseable date, and does not throw", () => {
    expect(() => formatClosureDetected("not a date")).not.toThrow()
    expect(formatClosureDetected("not a date")).toBeNull()
  })

  it("returns null for an invalid Date object", () => {
    expect(formatClosureDetected(new Date("nonsense"))).toBeNull()
  })

  it("exposes the timezone it formats in", () => {
    expect(CLOSURE_DETECTED_TIMEZONE).toBe("America/Denver")
  })
})
```

Also extend the existing import at the top of that file (line 2) from:

```ts
import { NEW_CLOSURE_WINDOW_DAYS, isNewClosure } from "@/lib/closure-recency"
```

to:

```ts
import {
  NEW_CLOSURE_WINDOW_DAYS,
  CLOSURE_DETECTED_TIMEZONE,
  isNewClosure,
  formatClosureDetected,
} from "@/lib/closure-recency"
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npx vitest run src/__tests__/closure-recency.test.ts
```

Expected: FAIL. `formatClosureDetected is not a function` (and a TypeScript complaint that neither `formatClosureDetected` nor `CLOSURE_DETECTED_TIMEZONE` is exported). The nine pre-existing `isNewClosure` / `NEW_CLOSURE_WINDOW_DAYS` tests must still pass.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/closure-recency.ts`, after `isNewClosure`:

```ts
/**
 * Fixed display timezone for detection dates.
 *
 * Deliberately NOT the viewer's local zone: a fixed zone makes this formatter
 * produce identical output on the server and the client, which is what lets the
 * server-rendered favorites page, the client-rendered browse list, and the map
 * popup's imperative HTML string all share one implementation without risking a
 * hydration mismatch.
 */
export const CLOSURE_DETECTED_TIMEZONE = "America/Denver"

/**
 * The card line for when the scraper detected a closure, or null when we have
 * no usable date — in which case the caller renders NOTHING. 22 of 79
 * production rows have a null `closedAt`; correct by omission.
 *
 * Says "detected", never "closed on": see this module's header.
 */
export function formatClosureDetected(
  closedAt: string | Date | null
): string | null {
  if (!closedAt) return null
  const detected = closedAt instanceof Date ? closedAt : new Date(closedAt)
  if (Number.isNaN(detected.getTime())) return null
  const date = detected.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: CLOSURE_DETECTED_TIMEZONE,
  })
  return `Closure detected ${date}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```
npx vitest run src/__tests__/closure-recency.test.ts
```

Expected: PASS, 17 tests (9 pre-existing + 8 new).

- [ ] **Step 5: Type-check**

```
npx tsc --noEmit
```

Expected: no errors. (If pre-existing unrelated errors appear, confirm they also occur on `origin/main` before touching them.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/closure-recency.ts src/__tests__/closure-recency.test.ts
git commit -m "feat(browse): shared closure-detected date formatter"
```

---

### Task 2: `/browse` list card renders the line

**Files:**
- Modify: `src/components/browse/CompetitorList.tsx` (import block line 4; render block lines 95-103)

**Interfaces:**
- Consumes: `formatClosureDetected` from Task 1.
- Produces: nothing consumed by later tasks.

This component already receives `closedAt` on each competitor (it calls `isNewClosure(c.closedAt, now)` at line 50), so there is no data plumbing to add.

There is no test step in this task. This repo's vitest runs in a **node** environment with a `.ts`-only test glob, so React components cannot be rendered or even imported in tests. The formatter's behavior is already locked down by Task 1; this task's gate is `tsc` plus a browser check.

- [ ] **Step 1: Extend the import**

In `src/components/browse/CompetitorList.tsx`, change line 4 from:

```ts
import { isNewClosure } from "@/lib/closure-recency"
```

to:

```ts
import { isNewClosure, formatClosureDetected } from "@/lib/closure-recency"
```

- [ ] **Step 2: Compute the line alongside the other per-card values**

Immediately after line 50 (`const isNew = isNewClosure(c.closedAt, now)`), add:

```ts
          const detectedLine = formatClosureDetected(c.closedAt)
```

- [ ] **Step 3: Render it as the card's last row**

The card currently ends with this distance block (lines 95-103):

```tsx
                {c.ownerDistanceMiles != null && c.ownerDistanceFrom ? (
                  <p className="text-xs text-hs-taupe mt-1">
                    ≈{c.ownerDistanceMiles.toFixed(1)} mi from {c.ownerDistanceFrom}
                  </p>
                ) : c.nearestHsName && c.nearestHsMiles != null ? (
                  <p className="text-xs text-hs-taupe mt-1">
                    {c.nearestHsMiles.toFixed(1)} mi from {c.nearestHsName}
                  </p>
                ) : null}
```

Add directly after that closing `) : null}` line, still inside the `<button>`:

```tsx
                {detectedLine && (
                  <p className="text-xs text-hs-mauve mt-1">{detectedLine}</p>
                )}
```

`text-hs-mauve` (not the `text-hs-taupe` used by the distance line) is deliberate: the two-tier treatment mirrors the map popup, where mauve marks metadata *about the record* and taupe marks facts *about the business*.

- [ ] **Step 4: Type-check**

```
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Confirm the full suite still passes**

```
npm test
```

Expected: PASS. No existing test touches this component; this catches accidental collateral damage.

- [ ] **Step 6: Verify in the browser**

Ask the user to start the dev server (`npm run dev`) — do not start it yourself. Then open `/browse`, switch to the competitor list, and confirm:
- Cards with a date show `Closure detected <Mon D, YYYY>` as the last line, in the lighter mauve.
- Cards without a date show no such line and no blank gap.
- Many cards legitimately share the same date (detection is batched — 19 production rows share 2026-05-11). This is expected, not a bug.

- [ ] **Step 7: Commit**

```bash
git add src/components/browse/CompetitorList.tsx
git commit -m "feat(browse): show closure detected date on competitor list cards"
```

---

### Task 3: Map popup uses the shared formatter

Removes the duplicate local date helper so both browse surfaces read from one implementation. Visible change: `Detected Jun 22, 2026` → `Closure detected Jun 22, 2026`.

**Files:**
- Modify: `src/components/browse/MapView.tsx` (import line 13; delete `formatClosedDate` at lines 91-95; rewrite the `detected` const at lines 114-116)

**Interfaces:**
- Consumes: `formatClosureDetected` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the import**

Change line 13 from:

```ts
import { isNewClosure } from "@/lib/closure-recency"
```

to:

```ts
import { isNewClosure, formatClosureDetected } from "@/lib/closure-recency"
```

- [ ] **Step 2: Delete the local formatter**

Delete these five lines (91-95) in their entirety:

```ts
function formatClosedDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "America/Denver" })
}
```

- [ ] **Step 3: Rewrite the `detected` line in `competitorPopupHtml`**

Replace lines 114-116:

```ts
  const detected = c.closedAt
    ? `<div style="font-size:11px;color:${BRAND.mauve};margin-top:6px;">Detected ${escapeHtml(formatClosedDate(c.closedAt))}</div>`
    : ""
```

with:

```ts
  const detectedLine = formatClosureDetected(c.closedAt)
  const detected = detectedLine
    ? `<div style="font-size:11px;color:${BRAND.mauve};margin-top:6px;">${escapeHtml(detectedLine)}</div>`
    : ""
```

Two things this fixes beyond deduplication: the guard is now on the *formatted* result rather than on the raw value, so an unparseable `closedAt` produces no element instead of the bare word "Detected" followed by nothing. `escapeHtml` stays even though the string is entirely app-generated — this is an HTML-string builder, and keeping every interpolation escaped is the pattern the rest of the function follows.

- [ ] **Step 4: Confirm no other caller of the deleted helper remains**

```
npx tsc --noEmit
```

Expected: no errors. A leftover `formatClosedDate` reference anywhere would surface here as "Cannot find name 'formatClosedDate'".

- [ ] **Step 5: Run the full suite**

```
npm test
```

Expected: PASS.

- [ ] **Step 6: Verify in the browser**

On `/browse` with the map showing, click a competitor pin that has a date and confirm the popup reads `Closure detected <Mon D, YYYY>` — word-for-word identical to the list card for the same competitor. Click a pin without a date and confirm no line appears where "Detected" used to be.

- [ ] **Step 7: Commit**

```bash
git add src/components/browse/MapView.tsx
git commit -m "refactor(browse): map popup uses shared closure-detected formatter"
```

---

### Task 4: Carry the detection date into `saved_competitors`

`saved_competitors` stores a **snapshot** of display fields rather than referencing `competitor_opportunities` — that table is fully reconciled each scraper run, so a foreign key would delete users' saves on churn. The snapshot has no date column, so the favorites card needs one added.

**Order matters inside this task.** The migration must be applied to the database *before* the Drizzle schema declares the column. `getSavedCompetitors` in the favorites page calls `findMany` with no `columns` clause, so it selects every column the schema declares — declaring `closed_at` before it exists would break `/account/favorites` and `toggleSavedCompetitor` with a Postgres "column does not exist" error.

**Files:**
- Create: `drizzle/0010_saved_competitors_closed_at.sql`
- Modify: `drizzle/meta/_journal.json` (append an entry to `entries`)
- Modify: `src/db/schema/savedCompetitors.ts` (add a column after line 28)
- Modify: `src/lib/saved-competitors.ts` (interface + mapper)
- Modify: `src/lib/saved-competitors-actions.ts` (parse defensively, persist)
- Test: `src/__tests__/saved-competitors.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces:
  - `SavedCompetitorInput` gains `closedAt: string | null` (an ISO string, matching `CompetitorClosure.closedAt`)
  - `savedCompetitors.closedAt` — a Drizzle `timestamp(..., { withTimezone: true })` column, so rows read back as `Date | null`

- [ ] **Step 1: Author the migration SQL**

Create `drizzle/0010_saved_competitors_closed_at.sql`:

```sql
ALTER TABLE "saved_competitors" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "saved_competitors" sc
  SET "closed_at" = co."closed_at"
  FROM "competitor_opportunities" co
  WHERE co."google_place_id" = sc."place_id";
```

Nullable with no default, mirroring the source column's own nullability — a competitor whose source row never had a date must not acquire a fake one.

`timestamp with time zone` deliberately deviates from `saved_competitors.created_at`'s bare `timestamp`: this column snapshots an instant from another system and must preserve it exactly rather than reinterpret it in another zone.

The `UPDATE` is a read of `competitor_opportunities` only — it does not violate the read-only rule for that table.

- [ ] **Step 2: Register the migration in the journal**

`drizzle-kit generate` is broken here, so the journal entry is hand-authored. The migrator reads **only** `_journal.json` to decide which files to run; a migration file with no entry is silently skipped.

In `drizzle/meta/_journal.json`, append to the `entries` array — after the `0009_owner_auto_alerts` entry, adding a comma to that entry's closing brace:

```json
    {
      "idx": 10,
      "version": "7",
      "when": 1786147200000,
      "tag": "0010_saved_competitors_closed_at",
      "breakpoints": true
    }
```

`when` must be greater than `0009`'s `1786060800000`; these values are hand-picked in this repo and only need to preserve ordering.

**Also create `drizzle/meta/0010_snapshot.json`.** This is mandatory, not optional: the pre-existing gate test `src/__tests__/db/migration-artifacts.test.ts` reads a snapshot for every `_journal.json` entry (lines 22-33) and asserts against the latest one (lines 35-46), so a journal entry without a matching snapshot fails the suite on a missing-file throw. Build it the low-risk mechanical way, exactly as 0005-0009 were built: copy `0009_snapshot.json`, give it a fresh `id`, set `prevId` to 0009's `id`, and insert only the new `closed_at` column into the `saved_competitors` table entry (after `maps_url`, before `created_at`) as `{"name":"closed_at","type":"timestamp with time zone","primaryKey":false,"notNull":false}`. Leave the table set otherwise identical.

- [ ] **Step 3: Apply the migration**

```
npm run db:migrate
```

Expected: `Running migrations...` then `Migrations complete`. This applies **only** `0010` — the database's `drizzle.__drizzle_migrations` table already records all 10 prior entries (verified 2026-08-04). The known "fresh `db:migrate` fails at 0008" problem applies to replaying from an empty database, not to this incremental run.

If it instead fails on a checksum/hash mismatch for an earlier migration, stop and report rather than editing older migration files. The fallback is to apply the two statements from Step 1 directly against `DATABASE_URL_DIRECT` and then insert the matching `drizzle.__drizzle_migrations` row by hand.

- [ ] **Step 4: Verify the column and the backfill against the real database**

Write `scripts/_tmp-verify-0010.ts`:

```ts
import { db } from "@/db"
import { sql } from "drizzle-orm"

async function main() {
  const cols = await db.execute(sql`
    select data_type, is_nullable
    from information_schema.columns
    where table_name = 'saved_competitors' and column_name = 'closed_at'`)
  console.log("column:", JSON.stringify(cols.rows ?? cols))

  const rows = await db.execute(sql`
    select count(*)::int as saved_rows,
           count(sc.closed_at)::int as with_date,
           count(*) filter (where sc.closed_at is distinct from co.closed_at)::int as mismatched
    from saved_competitors sc
    left join competitor_opportunities co on co.google_place_id = sc.place_id`)
  console.log("backfill:", JSON.stringify(rows.rows ?? rows))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

Run it (`tsx` does not load `.env.local` on its own, hence the flag):

```
npx tsx --env-file=.env.local scripts/_tmp-verify-0010.ts
```

Expected: `data_type: "timestamp with time zone"`, `is_nullable: "YES"`, and `mismatched: 0`. As of 2026-08-04 there is exactly 1 saved row and it has a date, so expect `saved_rows: 1, with_date: 1`.

Delete the script when done — it is a throwaway check, not a repo script:

```bash
rm scripts/_tmp-verify-0010.ts
```

- [ ] **Step 5: Add the column to the Drizzle schema**

In `src/db/schema/savedCompetitors.ts`, add after the `mapsUrl` line (line 28):

```ts
    // Detection timestamp snapshotted from competitor_opportunities.closed_at.
    // timestamptz (unlike created_at below) so the source instant survives.
    closedAt: timestamp("closed_at", { withTimezone: true }),
```

`timestamp` is already imported on line 1 — no import change needed.

- [ ] **Step 6: Write the failing test for the snapshot funnel**

`competitorToSnapshot` is the single funnel both the list rows and the map popup save through, so one mapping change covers both paths.

In `src/__tests__/saved-competitors.test.ts`, add `closedAt` to the expected object inside the first test (the fixture at line 15 already sets `closedAt: "2026-05-01T00:00:00.000Z"`). The assertion uses `toEqual` on the whole payload, so it fails until the mapper is updated:

```ts
  it("maps a CompetitorClosure to the saved-competitor input payload", () => {
    expect(competitorToSnapshot(closure)).toEqual({
      placeId: "place-123",
      brandName: "European Wax Center",
      address: "123 Main St",
      city: "Provo",
      state: "UT",
      lat: 40.2338,
      lng: -111.6585,
      businessStatus: "CLOSED_PERMANENTLY",
      mapsUrl: "https://maps.google.com/?cid=1",
      closedAt: "2026-05-01T00:00:00.000Z",
    })
  })
```

And add a case for the null-date rows, after the existing `"preserves a null mapsUrl"` test:

```ts
  it("preserves a null closedAt", () => {
    // 22 of 79 production rows have no closed_at; the snapshot must not invent one.
    expect(competitorToSnapshot({ ...closure, closedAt: null }).closedAt).toBeNull()
  })
```

- [ ] **Step 7: Run the test to verify it fails**

```
npx vitest run src/__tests__/saved-competitors.test.ts
```

Expected: FAIL. The `toEqual` assertion reports the payload is missing `closedAt`, and the new test reports `undefined` instead of `null`.

- [ ] **Step 8: Add `closedAt` to the input type and the mapper**

In `src/lib/saved-competitors.ts`, add to the `SavedCompetitorInput` interface after `mapsUrl` (line 17):

```ts
  closedAt: string | null // ISO string; when the scraper detected the closure
```

and to the `competitorToSnapshot` return object after `mapsUrl` (line 30):

```ts
    closedAt: c.closedAt,
```

- [ ] **Step 9: Run the test to verify it passes**

```
npx vitest run src/__tests__/saved-competitors.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 10: Persist the date, parsing defensively**

`toggleSavedCompetitor` is a `"use server"` export — a public POST endpoint whose input arrives from the client and is not validated. A client-supplied string flowing into a `timestamptz` column is a new crash vector, so parse it rather than passing it through.

In `src/lib/saved-competitors-actions.ts`, insert immediately before the `await db.insert(savedCompetitors).values({` call (line 33):

```ts
  // Input is unvalidated client data (this action's other fields are trusted
  // verbatim — a pre-existing gap). A malformed date must store null, not
  // reach the driver and throw.
  const parsedClosedAt = input.closedAt ? new Date(input.closedAt) : null
  const closedAt =
    parsedClosedAt && !Number.isNaN(parsedClosedAt.getTime()) ? parsedClosedAt : null
```

and add to the `.values({...})` object, after `mapsUrl: input.mapsUrl,` (line 44):

```ts
    closedAt,
```

- [ ] **Step 11: Type-check and run the full suite**

```
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass. `tsc` is what catches any other `SavedCompetitorInput` construction site that now needs `closedAt` — the field is required, not optional, so an omission is a compile error rather than a silent `undefined`.

- [ ] **Step 12: Verify the round trip in the browser**

Ask the user to start the dev server. Signed in, go to `/browse`, save a competitor that shows a `Closure detected` line, then confirm the new row persisted the date. Use a temp script file rather than `tsx -e` — an inline one-liner containing backticks and `$` does not survive PowerShell/bash quoting on this machine. Write `scripts/_tmp-check-saved.ts`:

```ts
import { db } from "@/db"
import { sql } from "drizzle-orm"

async function main() {
  const r = await db.execute(sql`
    select place_id, closed_at from saved_competitors
    order by created_at desc limit 3`)
  console.log(r.rows ?? r)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
```

Run it, then delete it:

```
npx tsx --env-file=.env.local scripts/_tmp-check-saved.ts
rm scripts/_tmp-check-saved.ts
```

Expected: the newest row carries a non-null `closed_at` matching that competitor's date. Also confirm `/account/favorites` still loads without error — that page selects every declared column, so it is the canary for a schema/database mismatch.

- [ ] **Step 13: Commit**

```bash
git add drizzle/0010_saved_competitors_closed_at.sql drizzle/meta/_journal.json src/db/schema/savedCompetitors.ts src/lib/saved-competitors.ts src/lib/saved-competitors-actions.ts src/__tests__/saved-competitors.test.ts
git commit -m "feat(favorites): snapshot closure detection date on saved competitors"
```

---

### Task 5: `/account/favorites` saved cards render the line

**Files:**
- Modify: `src/app/account/favorites/page.tsx` (import block lines 1-11; saved-competitor card lines 187-218)

**Interfaces:**
- Consumes: `formatClosureDetected` from Task 1; `savedCompetitors.closedAt` from Task 4.
- Produces: nothing.

This is a server component. `getSavedCompetitors` already selects every declared column, so `c.closedAt` is available as `Date | null` with no query change — which is why Task 1's formatter accepts `Date`.

- [ ] **Step 1: Add the import**

Add after line 11 (`import { formatUsdCentsCompact } from '@/lib/money'`), matching this file's single-quote style:

```ts
import { formatClosureDetected } from '@/lib/closure-recency'
```

- [ ] **Step 2: Render the line on the card**

The card's body currently ends with the Google Maps link (lines 208-217):

```tsx
                    {c.mapsUrl && (
                      <a
                        href={c.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-hs-red-600 hover:text-hs-red-700"
                      >
                        View on Google Maps →
                      </a>
                    )}
```

First compute the line once, in the `savedComps.map((c) => {` statement body — add it directly after the existing `const place = ...` line (line 189), matching how Task 2 does it:

```ts
                const detectedLine = formatClosureDetected(c.closedAt)
```

Then insert the render **before** the Maps-link block — directly after the address `<p>` that closes on line 207 — so the date sits with the record's metadata and the link stays the card's last, action-shaped element:

```tsx
                    {detectedLine && (
                      <p className="text-xs text-hs-mauve">{detectedLine}</p>
                    )}
```

Compute once into a local rather than calling the formatter twice (once in the guard, once in the body) — the duplicate call is the obvious-looking shortcut and it is worse on both readability and consistency with Task 2.

Note this card's wrapper is `flex flex-col gap-2`, so spacing comes from the parent `gap` — do **not** add `mt-1` here the way Task 2 does for the browse card, which has no such gap.

- [ ] **Step 3: Type-check**

```
npx tsc --noEmit
```

Expected: no errors. An error here means Task 4's Step 5 schema change is missing.

- [ ] **Step 4: Run the full suite**

```
npm test
```

Expected: PASS.

- [ ] **Step 5: Verify in the browser**

With the dev server running and signed in as a user who has a saved competitor, open `/account/favorites` and confirm the "Saved competitor locations" card shows `Closure detected <Mon D, YYYY>` between the address and the Maps link, with wording identical to the same competitor's `/browse` card. If a saved competitor has no date, confirm the card renders with no line and no stray gap.

- [ ] **Step 6: Commit**

```bash
git add src/app/account/favorites/page.tsx
git commit -m "feat(favorites): show closure detected date on saved competitor cards"
```

---

### Task 6: Reconcile the spec and open the PR

The spec's Verification section was written from a stale assumption about `db:migrate`. Correct it so the next reader does not hand-apply SQL unnecessarily.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-competitor-closure-detected-date-design.md` (Verification section)

- [ ] **Step 1: Correct the migration note in the spec**

Replace this bullet in the Verification section:

```
- Migration applied by hand and verified with a direct query; `npm run db:migrate`
  from scratch is known to fail at 0008 and is not a usable gate here.
```

with:

```
- Migration applied with `npm run db:migrate` and verified by direct query.
  The database's `drizzle.__drizzle_migrations` table already records 0000-0009,
  so this run applies only 0010. (The known "fails at 0008" problem applies to
  replaying the whole folder against an empty database, not to this incremental
  run.) The `_journal.json` entry AND `meta/0010_snapshot.json` are both
  hand-authored because `drizzle-kit generate` is broken — the snapshot is
  required by the `migration-artifacts.test.ts` gate, which reads one per
  journal entry.
```

- [ ] **Step 2: Note the widened formatter signature**

In the spec's section 1, the signature reads `formatClosureDetected(closedAt: string | null)`. Replace that line with:

```ts
export function formatClosureDetected(closedAt: string | Date | null): string | null
```

and add below it:

```
`Date` is accepted alongside `string` because the favorites page holds a `Date`
straight from the Drizzle driver while the browse surfaces hold an ISO string.
```

- [ ] **Step 3: Run the full gate one final time**

```
npm test
npx tsc --noEmit
```

Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit and push**

```bash
git add docs/superpowers/specs/2026-08-04-competitor-closure-detected-date-design.md
git commit -m "docs: correct migration + formatter notes in closure-date spec"
git push -u origin feature/competitor-closure-detected-date
```

If the push 403s, switch accounts — only `sugarparker` can push to this repo:

```bash
gh auth switch
```

- [ ] **Step 5: Open the PR against `origin/main`**

```bash
gh pr create --base main --title "feat: show closure detection date on competitor cards" --body "$(cat <<'EOF'
Adds a `Closure detected <date>` line to every competitor closure we surface —
the /browse list cards, the map popup, and the /account/favorites saved cards —
from one shared formatter in `src/lib/closure-recency.ts`.

`closed_at` is the scraper's **detection** timestamp, not the date the business
closed, so the copy says "detected" throughout.

### Two accepted limitations, both properties of the scraper's data

- **22 of 79 production rows have no `closed_at`**, so those cards show no line.
  Correct by omission — we don't claim a date we don't have.
- **Detection is batched.** The scraper reconciles weekly/monthly, so dates land
  in clumps: 19 rows share 2026-05-11, 12 share 2026-06-15. Many cards showing
  the same date is expected.

### Notes

- Migration `0010` adds a nullable `closed_at` to `saved_competitors` and
  backfills it by `place_id`, because that table snapshots display fields rather
  than referencing the scraper-owned table. Applied and verified: 1 saved row,
  backfilled, 0 mismatches. The `_journal.json` entry is hand-authored since
  `drizzle-kit generate` is broken in this repo.
- `toggleSavedCompetitor` now parses the incoming date defensively — a malformed
  client value stores null instead of throwing at the driver.
- The map popup's local `formatClosedDate` is deleted in favor of the shared
  formatter, so its copy changes from `Detected …` to `Closure detected …`.
- No component tests: vitest runs in a node env with a `.ts`-only glob, so the
  formatter is unit-tested and the three render sites were checked in a browser.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage** — every spec section maps to a task:

| Spec section | Task |
| --- | --- |
| 1. Shared formatter (+ fixed timezone, `string \| null` return) | 1 |
| 2. `/browse` list card, mauve, last row | 2 |
| 3. Map popup uses helper, local helper deleted | 3 |
| 4a. Migration `0010` + backfill | 4 (Steps 1-4) |
| 4b. Schema + snapshot funnel | 4 (Steps 5-9) |
| 4c. Server-action hardening | 4 (Step 10) |
| 4d. Favorites card | 5 |
| Verification (vitest, tsc, no `next build`, manual browser) | every task; final gate in 6 |
| Out-of-scope items | not implemented anywhere — confirmed |

**Two intentional deviations from the spec, both reconciled in Task 6:** the formatter accepts `Date` as well as `string` (the favorites page holds a `Date` from the driver), and the migration is applied with `npm run db:migrate` rather than by hand (the journal table already records 0000-0009, so only 0010 runs).

**Type consistency** — `formatClosureDetected(closedAt: string | Date | null): string | null` is declared in Task 1 and called with that exact name in Tasks 2, 3, and 5. `SavedCompetitorInput.closedAt` is `string | null` (ISO), matching `CompetitorClosure.closedAt`; the Drizzle column reads back as `Date | null`, which is why Task 5 can pass `c.closedAt` straight in. `CLOSURE_DETECTED_TIMEZONE` is exported in Task 1 and asserted in Task 1's tests only.

**Ordering constraint** — Task 4 applies the migration (Steps 1-4) before declaring the schema column (Step 5). Reversing these breaks `/account/favorites` and `toggleSavedCompetitor`, since `getSavedCompetitors` selects every declared column. Task 5 depends on Task 4; Tasks 2 and 3 depend only on Task 1 and are independent of each other.
