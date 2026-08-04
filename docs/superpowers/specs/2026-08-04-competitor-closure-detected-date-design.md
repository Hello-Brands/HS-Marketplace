# Competitor closure detection date on opportunity cards

**Date:** 2026-08-04
**Status:** Approved, ready for implementation plan

## Goal

Every competitor closure we surface should say when the scraper detected the
closure — "Closure detected Jun 22, 2026". This serves two purposes for the
viewer: it distinguishes recent closures from stale ones, and it shows how
current the underlying data is.

## Data reality (verified against production, 2026-08-04)

`competitor_opportunities.closed_at` is the detection timestamp — when the
external competitor-monitor scraper first saw the location closed — **not** when
the business actually closed. All user-facing copy must say "detected".

| Fact | Value |
| --- | --- |
| Total rows | 79 (72 `CLOSED_PERMANENTLY`, 7 `CLOSED_TEMPORARILY`) |
| Rows with a `closed_at` | 57 (51 permanent, 6 temporary) |
| Rows with **no** `closed_at` | 22 (28%) |
| Distinct detection days | 8 |
| Date range | 2026-03-17 → 2026-08-02 |
| `synced_at` spread | All 79 rows within a 7-second window on 2026-08-02 |

Two accepted consequences, both properties of the scraper's data rather than of
this code:

- **28% of cards will carry no line.** Accepted: we do not claim a date we do
  not have. Cards render one line shorter.
- **Dates arrive in clumps.** The scraper reconciles weekly/monthly, so
  detection dates cluster on run days — 19 rows share 2026-05-11, 12 share
  2026-06-15, 12 share the first-ever run on 2026-03-17. A scrolled list will
  show many identical dates. Accepted as accurate.

`synced_at` is uniform across every row (it marks the last scraper run, not a
per-row last-seen), so it cannot serve as a per-card fallback. A "data as of"
header line was considered and **rejected** for this change.

## Design

### 1. One shared formatter

Add to `src/lib/closure-recency.ts`:

```ts
export function formatClosureDetected(closedAt: string | null): string | null
```

- `null` or an unparseable string → returns `null`, and the caller omits the
  line entirely.
- A valid ISO string → `"Closure detected Jun 22, 2026"`
  (`en-US`, `{ year: "numeric", month: "short", day: "numeric" }`).

Formatting is pinned to `timeZone: "America/Denver"`, matching the timezone the
map popup already uses. A fixed zone — rather than the viewer's local zone — is
what makes a single function safe across all three call sites: server-rendered
(favorites page), client-rendered (browse list), and built into an imperative
HTML string (map popup). Server and client produce byte-identical output, so
there is no hydration mismatch.

`closure-recency.ts` is the right home: it is already the pure, `server-only`-free
module documenting `closedAt` semantics — including the rule that copy must say
"Detected", never "Closed on" — and both client components and vitest can
import it.

Returning `string | null` rather than an empty string keeps the "omit the line"
decision at one place in each caller (`{line && <p>{line}</p>}`) and makes the
null-date case explicit rather than rendering an empty element.

### 2. `/browse` list card — `src/components/browse/CompetitorList.tsx`

Add the line as the card's final row, after the address and the distance line:

```
Permanently Closed
1234 Main St · Boulder, CO
2.3 mi from Boulder
Closure detected Jun 22, 2026
```

Styling: `text-xs text-hs-mauve mt-1`. Mauve rather than the `hs-taupe` used by
the distance line — the two-tier treatment mirrors the map popup, where mauve
already marks metadata *about the record* and taupe marks facts *about the
business*.

The component already receives `closedAt` (it calls `isNewClosure` on it), so
this is display-only — no data plumbing changes.

### 3. Map popup — `src/components/browse/MapView.tsx`

The popup already renders a detected date via a local `formatClosedDate` helper.
Delete that helper, call `formatClosureDetected` instead, and keep the existing
`BRAND.mauve` styling.

Visible change: `Detected Jun 22, 2026` → `Closure detected Jun 22, 2026`. Both
surfaces then read identically from one source of truth.

### 4. `/account/favorites` saved cards

`saved_competitors` stores a **snapshot** of display fields rather than
referencing the scraper table (which is fully reconciled each run, so a foreign
key would delete users' saves on scraper churn). The snapshot has no date
column, so this surface needs four changes:

**4a. Migration `drizzle/0010_saved_competitors_closed_at.sql`**

Hand-authored — `drizzle-kit generate` is broken in this repo (snapshot drift).

```sql
ALTER TABLE "saved_competitors" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "saved_competitors" sc
  SET "closed_at" = co."closed_at"
  FROM "competitor_opportunities" co
  WHERE co."google_place_id" = sc."place_id";
```

Nullable with no default, mirroring the source column's own nullability — a
saved competitor whose source row never had a date must not acquire a fake one.

`timestamptz` deliberately deviates from `saved_competitors.created_at`'s bare
`timestamp`: the snapshot should preserve the source instant exactly rather than
reinterpret it in another zone.

Backfill risk is nil — verified against production: 1 saved row, 1 matching
scraper row, 1 date available.

**4b. Schema and snapshot funnel**

- `src/db/schema/savedCompetitors.ts` — add `closedAt: timestamp("closed_at", { withTimezone: true })`.
- `src/lib/saved-competitors.ts` — add `closedAt: string | null` to
  `SavedCompetitorInput`, and map `c.closedAt` in `competitorToSnapshot`.

`competitorToSnapshot` is the single funnel through which both the list rows and
the map popup save, so one edit covers both paths.

**4c. Server-action hardening — `src/lib/saved-competitors-actions.ts`**

`toggleSavedCompetitor` persists its input verbatim; the input comes from the
client and is not validated. A client-supplied date string flowing into a
`timestamptz` column is a new crash vector, so parse defensively:

```ts
const parsed = input.closedAt ? new Date(input.closedAt) : null
const closedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
```

A malformed value stores `null` instead of throwing at the driver. This action
validates none of its other fields either — a pre-existing gap that this change
does not widen and does not fix.

**4d. Card**

`src/app/account/favorites/page.tsx` — render the same line from the same
helper, below the address, server-side.

## Out of scope

- The "New" star badge on favorites cards (browse only).
- Alert email copy (`src/lib/email.ts`).
- A "Data as of <synced_at>" header line — considered, rejected for this change.
- Sort changes. `annotateAndSortCompetitors` already ranks newest-detected first
  in its no-search / no-owner-points branch.
- Consolidating the three copies of `statusLabel` (browse list, map popup,
  favorites page) — unrelated to this change.

## Verification

- `vitest run` — new cases in `src/__tests__/closure-recency.test.ts`: null
  input, unparseable input, exact output string for a known ISO timestamp, and a
  UTC-early-morning timestamp that falls on the previous day in Denver (pins
  both the fixed zone and the format).
- `tsc --noEmit` for types. Do not run `next build` while the dev server is up
  (Windows `.next` lock).
- No component tests are possible in this repo (vitest runs in a node env with a
  `.ts`-only glob, and `MapView.tsx` cannot even be imported). The three render
  sites get manual browser confirmation instead.
- Migration applied by hand and verified with a direct query; `npm run db:migrate`
  from scratch is known to fail at 0008 and is not a usable gate here.

## Branch

`feature/competitor-closure-detected-date`, cut from `origin/main`. One PR.
