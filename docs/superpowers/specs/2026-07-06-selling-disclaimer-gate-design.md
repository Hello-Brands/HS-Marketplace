# Selling Your Franchise — Pre-Listing Disclaimer Gate

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan

## Summary

Before a seller starts the add-listing wizard at `/seller/listings/new`, show a
full-page **"Selling Your Franchise" disclaimer interstitial** covering resale
timing, valuation, and the fee structure, ending in an acknowledgment the seller
must check to unlock the form. Each acknowledgment is recorded (timestamp + FDD
version) for legal cover.

The closing "permanent" messaging is deliberately reframed so it does **not**
scare sellers off: **listing is reversible** (remove it anytime, no penalty);
only a **completed sale/transfer** is permanent.

## Goals

- Inform sellers of the resale process (timing, valuation, fees) before they invest effort in the form.
- Provide legal cover for the fee structure and the permanence of a completed sale.
- Keep listing itself feeling low-commitment so sellers aren't deterred from listing.
- Record each acknowledgment for audit.

## Non-Goals (YAGNI)

- No gate on the edit flow (`/seller/listings/[id]/edit`) — this is for *starting* a new listing.
- No per-session / per-user suppression — the gate shows on every visit to `/new`.
- No dynamic fee amounts — copy is static; amounts stay as "per your Franchise Agreement / 2026 FDD" (broker fee is the only figure: "$30,000 flat or 10%").
- No admin UI to view the acknowledgment log (audit table only, queryable directly).
- No editing of the disclaimer copy through the app (hardcoded).

## Design decisions (resolved during brainstorming)

| Decision | Choice |
|---|---|
| Display treatment | **Option A — full-page interstitial** ("Step 0"): a dedicated screen that replaces the form until acknowledged. |
| "Permanent" messaging | Reframed: **two-tone callout** — green "listing commits you to nothing" beside amber "a completed sale is permanent". |
| Re-show behavior | **Every visit** to `/seller/listings/new`. Not shown on the edit flow. |
| Record acknowledgment | **Yes** — append-only audit row per acknowledgment (userId, fddVersion, timestamp). |
| Record-to-proceed | If recording fails, show a retry error and do NOT reveal the wizard. |
| Schema apply | **Hand-authored migration `0004` + `db:migrate`** (NOT `db:push` — see Migration safety). |

## Context (current state)

- `src/app/seller/listings/new/page.tsx` is a server component: auths the session
  (redirects to `/login` if none) and renders `<ListingWizard userId={...} />`
  inside a heading + card shell.
- `src/components/listings/ListingWizard.tsx` is a 3-step client wizard
  (Type & Location → Financials → Photos & Details) using `StepIndicator total={3}`.
- Server actions in `src/lib/listings/actions.ts` auth via `await auth()` then a
  seller guard (`session.user.sellerAccess || role === 'admin'`), throwing
  `'Not authenticated'` / a forbidden error otherwise.
- Schema barrel is `src/db/schema.ts` (`export * from "./schema/<file>"`); the DB
  is push-managed. Append-log tables follow `src/db/schema/loginEvents.ts`
  (uuid id, `userId` FK with `onDelete: "cascade"`, `createdAt` default now,
  indexes on the queried columns).
- Brand: Montserrat, `hs-red` palette; caramel `#B9772E` / `#F3E4D0` for
  informational warmth; existing green utilities (e.g. `text-green-600`) used for
  positive states like "Draft saved".

## Architecture

### 1. Content component — `SellingDisclaimer.tsx`

`src/components/listings/SellingDisclaimer.tsx` — a presentational (no-state)
component rendering the approved Option A content:

- **Header:** "Selling Your Franchise" + "Before you begin, here's what you should know about the resale process."
- **The basics** — two cards: "⏱ How long does it take?" (1–18 months…) and "💰 What's it worth?" (3–5× multiple…), copy verbatim.
- **Fee structure** — "Review all applicable fees before submitting your inquiry."
  - **Option A — Self-Managed Sale**: intro + bullets (Transfer Fee per FA/2026 FDD; Fee Deposit per FA; own legal fees).
  - **Option B — Hello Sugar-Managed Sale**: intro + bullets (Transfer Fee; Resale Assistance Fee) + **Broker Fees** callout ("$30,000 flat or 10% of the final sale price… is the seller's responsibility").
  - Wire note: "All fees must be wired to Hello Sugar 3 business days prior to close."
- **Two-tone close** — reframed permanence:
  - Green pane, "✓ Listing commits you to nothing": remove your listing anytime before a sale closes — no penalty, no obligation.
  - Amber pane, "⚠️ A completed sale is permanent": once a transfer closes you're no longer a Hello Sugar franchisee; be sure before finalizing.

All copy hardcoded here. Brand-styled with existing Tailwind tokens.

### 2. Gate component — `ListingDisclaimerGate.tsx`

`src/components/listings/ListingDisclaimerGate.tsx` (client), props `{ userId: string }`.

- Renders `<SellingDisclaimer />`, then an acknowledgment row: a checkbox +
  label — "I have read and understand the fee structure, and I understand that
  while I can remove my listing at any time, **a completed sale is permanent**."
- **Continue to Form →** button, disabled until the box is checked.
- On Continue: call the server action `acknowledgeSellingDisclaimer()`.
  - Success → set local `acknowledged` state true → render `<ListingWizard userId={userId} />` in place of the gate.
  - Failure → show an inline retry error (`role="alert"`), keep the gate, leave the box checked so the user can just re-click Continue. The wizard is not revealed.
- A pending state disables Continue and shows a spinner/label while the action is in flight.

State is local (`useState`); nothing persisted client-side, so the gate re-shows on every fresh `/new` load.

### 3. Server action + FDD version — `disclaimer-actions.ts`

`src/lib/listings/disclaimer-actions.ts`:

```ts
export const FDD_VERSION = "2026"

export async function acknowledgeSellingDisclaimer(): Promise<{ ok: true }>
```

- Auth: `await auth()`; require an authenticated session (`session.user.id`),
  matching the guard the `/seller/listings/new` page itself uses. It does NOT
  apply the stricter `sellerAccess` check, because (a) the ack is informational
  and (b) the listing-creation actions already enforce `sellerAccess` downstream —
  gating the ack more tightly than the page would hard-block someone who can
  legitimately reach the interstitial. Throw if unauthenticated.
- Insert one row into `listing_disclaimer_acknowledgments`
  (`userId = session.user.id`, `fddVersion = FDD_VERSION`; `acknowledgedAt`
  defaults to now).
- Return `{ ok: true }` on success; let errors propagate so the client shows the
  retry error (record-to-proceed).

### 4. Schema — `disclaimerAcknowledgments.ts`

`src/db/schema/disclaimerAcknowledgments.ts`, modeled on `loginEvents.ts`:

```ts
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
```

Append-only (no updates/deletes from the app). Add `export * from
"./schema/disclaimerAcknowledgments"` to `src/db/schema.ts`.

The acknowledgment happens before any listing exists, so it ties to the seller
(userId), not a listing — a per-attempt audit record.

### 4a. Migration safety — hand-author `0004`, do NOT `db:push`

This branch is cut from `main`, whose schema does **not** yet contain the
`owner_locations` coordinate columns (`latitude`/`longitude`/`geocoded_at`) — those
live in the in-flight map-layer feature (PR #25, unmerged). The **live Neon DB
already has** those columns (pushed + backfilled). Therefore `drizzle-kit push`
from this branch would diff the full schema against the live DB and try to
**DROP** the coordinate columns (and their data) — unacceptable.

Instead, hand-author a migration that creates ONLY the new table (the documented
"add a new table" pattern, as `0002_competitor_opportunities` was added):

- `drizzle/0004_listing_disclaimer_acknowledgments.sql` — `CREATE TABLE` + the
  index, Drizzle style (quoted idents, `--> statement-breakpoint`), with the FK to
  `"user"`/users matching how `0003` references it.
- Append an entry to `drizzle/meta/_journal.json` (idx 4, a tag, `when` greater
  than the last applied — the migrator keys off `when` vs
  `drizzle.__drizzle_migrations.created_at`).
- Add `drizzle/meta/0004_snapshot.json` (copy `0003`'s snapshot, new `id`,
  `prevId` = `0003`'s id, insert the new table).
- Apply with `npm run db:migrate`, which reads journal + sql only and applies just
  `0004` (it is a clean no-op for `0000`–`0003` on the existing DB). This touches
  only the new table — it never diffs or drops the `owner_locations` columns.

(When PR #25 merges, `main` will hold the coord columns; this branch's migration
is independent and does not conflict.)

### 5. Page wiring — `new/page.tsx`

Replace `<ListingWizard userId={...} />` with `<ListingDisclaimerGate userId={...} />`.
The gate owns whether the wizard is shown. Heading + card shell unchanged. The
edit page and all other routes are untouched.

## Data flow

```
/seller/listings/new (server: auth → userId)
  └─ ListingDisclaimerGate (client)
       ├─ SellingDisclaimer (static content)
       ├─ [checkbox] + Continue
       │     └─ acknowledgeSellingDisclaimer()  → insert audit row (userId, FDD_VERSION, now)
       │            success → reveal ListingWizard
       │            failure → retry error, gate stays
       └─ ListingWizard (only after acknowledged)
```

## Error handling & edge cases

- Recording failure → inline retry error, wizard withheld (record-to-proceed).
- Unauthenticated / non-seller hitting the action → throws (page already redirects unauthenticated users; the action re-guards defensively).
- Checkbox unchecked → Continue disabled (client), and the action is never called.
- Refresh / re-entry to `/new` → gate shows again and records again (intended).
- Editing an existing draft → no gate (different route).

## Testing

- **Server action** (`src/__tests__/…`, mirroring existing action tests that mock
  `@/auth` and the db): an unauthenticated caller is rejected (throws); an
  authenticated user inserts exactly one row with `userId` and
  `fddVersion === FDD_VERSION`; a DB insert error propagates (so the client can
  withhold the wizard).
- **FDD version constant**: a trivial guard asserting `FDD_VERSION` is the
  expected value (so a copy/version bump is deliberate).
- **Gate / content rendering**: tsc-gated + manual (repo vitest env is node-only,
  no DOM/RTL harness) — consistent with existing UI components. Manual check:
  Continue disabled until checked; success reveals the wizard; the edit flow shows
  no gate.

## Affected files

- `src/db/schema/disclaimerAcknowledgments.ts` — new table.
- `src/db/schema.ts` — export the new table.
- `drizzle/0004_listing_disclaimer_acknowledgments.sql` + `drizzle/meta/_journal.json` + `drizzle/meta/0004_snapshot.json` — hand-authored migration (see Migration safety); applied via `npm run db:migrate`.
- `src/lib/listings/disclaimer-actions.ts` — `FDD_VERSION` + `acknowledgeSellingDisclaimer()`.
- `src/components/listings/SellingDisclaimer.tsx` — content.
- `src/components/listings/ListingDisclaimerGate.tsx` — gate + acknowledgment + reveal.
- `src/app/seller/listings/new/page.tsx` — render the gate.
- tests as above.
