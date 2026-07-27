# Multi-Owner Links — Design

**Date:** 2026-07-27
**Status:** Approved pending spec review
**Branch:** `feat/multi-owner-links` (PR to `origin/main`; no merge without explicit approval)

## Summary

A user can currently be attached to at most one owner profile, because the link
is a single scalar column (`users.ownerIdentifier`). Several real owners appear
in the directory under more than one `owner_identifier` — one profile per
co-ownership grouping — so those owners are silently missing locations. Replace
the scalar with a `user_owner_links` join table so one user can hold many owner
profiles, and make the login-time matcher attach every profile the user's email
matches.

## Background

### The bug, as observed

On `/admin/owner-directory`, Austin Towns is attached to `ut-lines-towns` but
not to `ut-towns`, so their Ogden/Riverdale location does not appear on
`/account/locations` and serves no financials.

### Root cause

`src/db/schema/auth.ts:21-22` models the link as two scalar columns:

```ts
ownerIdentifier: text("owner_identifier"),
ownerLinkSource: text("owner_link_source", { enum: ["auto", "manual"] }),
```

One user → at most one `owner_identifier`. Every consumer reads that single
value:

- `getMyOwnerLocations` (`src/lib/owner-directory/data.ts:36`) filters
  `eq(ownerLocations.ownerIdentifier, ownerId)`.
- `canOwnerFetchLiveData` (`src/lib/kpi/access.ts:12-22`) gates live BigQuery
  financials on `rowOwnerIdentifier === sessionOwnerIdentifier`.
- `deriveCapabilities` (`src/lib/navigation.ts:36`) derives `isOwner` from the
  column being non-null.
- The session callback (`src/auth.ts:49`) copies it to
  `session.user.ownerIdentifier`.

Additionally, `decideOwnerLink` (`src/lib/owner-directory/link.ts:23-26`)
returns `{ action: "skip", reason: "multiple_owners" }` when an email matches
two or more identifiers, and `linkOwnerAtLogin` only logs a warning
(`login.ts:52-56`). So the automatic matcher links such a user to **nothing**;
Austin's current attachment must be an admin manual override, and because
`source: "manual"` is a sticky per-user lock (`link.ts:20-22`), that override
permanently prevents any automatic correction.

### Confirmed scope (BigQuery `vw_monday_data_raw`, queried 2026-07-27)

`austin@hellosugar.salon` is the contact on three identifiers:

| owner_identifier | locations |
| --- | --- |
| `ut-lines-towns` | 8 — Bountiful 042, Farmington 227, Heber City 236, Park City 235, Riverton 237, SLC Sugar House 126, West Jordan 238, West Valley 176 |
| `ut-towns` | 1 — UT Ogden \| Riverdale 082 |
| `Unknown Owner` | 1 — GA Alpharetta \| North Point 037 |

Note the split is the inverse of the initial report: the co-owned profile holds
8 locations and the solo profile holds 1.

Not a one-off — three emails match multiple linkable profiles:

```
austin@hellosugar.salon       ut-lines-towns(8), ut-towns(1)
kansascity@hellosugar.salon   ks-ma-mo-coles(1), ks-mo-coles(1)
weston@hellosugar.salon       ks-mo-coles(1), ma-coles(3)
```

The **reverse** direction already works: `ownerIdentifier` is not unique on
`users`, so several users can point at the same profile. Six profiles carry
multiple contact emails (`ks-mo-coles` 3; `az-corp`, `ma-coles`,
`ok-tx-wa-schaumleffle`, `nv-tx-parry`, `tx-hughes` 2 each). Only the
one-user-to-many-owners direction is missing.

## Decisions (from brainstorming)

1. **Auto-link to every matching profile.** The `multiple_owners` skip is
   removed. Multi-profile users are linked automatically with no admin action.
2. **Admin removal is durable, recorded as a suppression.** A revoked link is a
   row with `source: "revoked"`, and the auto matcher skips any owner revoked
   for that user. Manual adds and manual removals both survive re-sync and
   re-login; everything else tracks the directory.
3. **`/account/locations` shows a flat merged list.** `owner_identifier` never
   appears in owner-facing UI — it is internal bookkeeping that encodes
   co-ownership groupings, not a concept owners hold.
4. **Admin UI keeps one table row per user**, with each link rendered as a chip
   carrying its source badge and a single action.
5. **Revoked links stay visible** (muted, with an undo) so a suppression is
   never invisible.
6. **The `multiple_owners` warning log is replaced** by a count in the admin
   page header ("N users linked to multiple owners").

## Architecture

### Data model

New table `user_owner_links`, in a new file `src/db/schema/userOwnerLinks.ts`
exported from `src/db/schema.ts`:

```ts
export const userOwnerLinks = pgTable("user_owner_links", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ownerIdentifier: text("owner_identifier").notNull(),
  // auto    = derived from the directory email match, refreshed each login
  // manual  = added by an admin, never touched by the auto matcher
  // revoked = admin suppression; the auto matcher must skip this owner
  source: text("source", { enum: ["auto", "manual", "revoked"] }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Admin who added or revoked; null for auto links.
  actorUserId: text("actor_user_id").references(() => users.id),
}, (t) => [
  uniqueIndex("user_owner_links_user_owner_idx").on(t.userId, t.ownerIdentifier),
  index("user_owner_links_user_idx").on(t.userId),
])
```

Three deliberate properties:

- **Revocation is a `source` value, not a second table.** One row per
  (user, owner) with one state, so the unique index makes "linked and revoked
  simultaneously" unrepresentable. *Effective* links are
  `source IN ('auto','manual')`; the admin UI reads all three.
- **`ownerIdentifier` is a soft reference, not a foreign key.** It cannot be an
  FK: `owner_locations` has no unique constraint on `ownerIdentifier` alone (the
  unique index is `(ownerIdentifier, blvdLocationName)`,
  `ownerLocations.ts:68-71`) and the sync is a full refresh. This matches the
  existing `users.ownerIdentifier` behavior, so it is not new risk — but a link
  can point at an identifier the sync later drops, which the admin UI must
  surface as "not in directory".
- **`users.ownerIdentifier` and `users.ownerLinkSource` are removed.** A
  "primary owner scalar plus overflow table" hybrid was rejected: two sources of
  truth for one fact, the same class of problem as DEBT-003.

Rejected alternative: keep the scalar and store several identifiers in it
(delimited string or Postgres array). It avoids a table but cannot carry
per-link `source`/`actorUserId`/timestamps, cannot be indexed for "who is linked
to `az-corp`", and gives up the uniqueness guarantee.

### Reconciliation (`src/lib/owner-directory/link.ts`)

`decideOwnerLink` is replaced by a pure set-reconciling planner — no I/O, fully
unit-testable, same as today:

```ts
export type OwnerLinkPlan = {
  toAdd: string[]     // insert as source="auto"
  toRemove: string[]  // delete stale auto links
  skipped: { ownerIdentifier: string; reason: "revoked" | "manual" }[]
}

export function planOwnerLinks(args: {
  matchedOwnerIdentifiers: string[]  // from the directory; Unknown Owner already excluded
  existingLinks: { ownerIdentifier: string; source: "auto" | "manual" | "revoked" }[]
}): OwnerLinkPlan
```

`skipped` drives observability only — `linkOwnerAtLogin` logs it so a
"why is this owner not linked?" question is answerable from logs. It is not
persisted and callers must not branch on it.

| Directory match | Existing row | Result |
| --- | --- | --- |
| yes | none | add as `auto` |
| yes | `auto` | leave (idempotent) |
| yes | `manual` | leave — never downgrade manual to auto |
| yes | `revoked` | skip |
| no | `auto` | **remove** |
| no | `manual` | leave — manual is durable |
| no | `revoked` | leave |

The load-bearing row is **no match + `auto` → remove**. It is what makes the
system self-healing: correcting a wrong `owner_contact_email` in Monday, then
re-syncing, drops the bad link on that user's next login with no admin action.
Without it, decision 1 leaks access permanently and manual revocation becomes
load-bearing for correctness rather than exceptional.

As today, the caller excludes `UNKNOWN_OWNER` from `matchedOwnerIdentifiers`
before planning.

### Login (`src/lib/owner-directory/login.ts`)

`linkOwnerAtLogin` reads the normalized-email matches and the user's existing
links, calls `planOwnerLinks`, and applies adds/removes in one `db.batch` (the
Neon HTTP driver has no `db.transaction`). Its contract is unchanged: never
throws, never blocks sign-in, all failures logged and swallowed. The
`multiple_owners` warning is deleted — that state is now normal.

### Session (`src/auth.ts`, `src/types/next-auth.d.ts`)

`session.user.ownerIdentifier: string | null` becomes
`session.user.ownerIdentifiers: string[]`, filled by one indexed query on
`user_owner_links` in the session callback, selecting **effective links only**
(`source IN ('auto','manual')`). Revoked rows never reach the session.

Cost, stated plainly: today that line is free because the Drizzle adapter has
already loaded the user row; this adds a second query per session resolution,
and `auth()` is called more than once per render in places (page +
`SiteHeader`). Accepted because it is a single `user_id`-indexed lookup, it
keeps every existing `session.user.X` consumer shaped the same, and it reads
fresh — so an admin revoke takes effect on the owner's next page load rather
than requiring sign-out.

Alternatives considered: a denormalized `owner_identifiers` array column on
`users` maintained by the linker (fast, but reintroduces the dual source of
truth just removed), and keeping links out of the session behind a
request-`cache()`d accessor (cheapest, but every consumer changes shape and
`deriveCapabilities` becomes async). If query count later shows up in traces,
the denormalized column is a contained optimization behind the same accessor.

### Access gate (`src/lib/kpi/access.ts`)

```ts
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

The `?.length` guard is required: an empty array must read as "not an owner".
`.includes()` on `[]` returns `false` correctly, but `[]` is truthy, so a future
refactor to a bare truthiness check on the array would silently open the gate.

`fetchOwnerLocationKpis` (`src/lib/kpi/fetch.ts:197-214`) changes its
`sessionOwnerIdentifier` parameter to `sessionOwnerIdentifiers: string[]`, and
`src/app/account/locations/[id]/page.tsx:48` passes
`session.user.ownerIdentifiers ?? []`.

### Capabilities (`src/lib/navigation.ts`, `src/components/layout/SiteHeader.tsx`)

`SessionUserLike.ownerIdentifier?: string | null` becomes
`ownerIdentifiers?: readonly string[] | null`, and `deriveCapabilities`
(`navigation.ts:36`) derives `isOwner: !!user.ownerIdentifiers?.length`.
`deriveCapabilities` stays synchronous and pure — the session already carries
the array. `SiteHeader.tsx:21` passes the array through instead of the scalar.

### Query scoping (`src/lib/owner-directory/data.ts`)

`getMyOwnerLocations` returns `{ ownerIdentifiers: string[], locations }`, where
`locations` is the flat union across all effective links ordered by
`blvdLocationName`. Two invariants carried forward from the current code:

- **An empty owner set returns early without querying.** Drizzle's
  `inArray(col, [])` does emit a false predicate, but this security property
  must not rest on that; the early return is explicit.
- **`UNKNOWN_OWNER` is filtered from the result set** even if a link somehow
  exists, alongside the linker's `ne(...)` exclusion and `addOwnerLink`'s
  rejection.

`getMyOwnerLocationById` (`my-location.ts`) needs no change: it delegates to
`getMyOwnerLocations`, so it inherits the widened scope and keeps its
"404 on anything you don't own" behavior.

### Owner-facing UI (`src/app/account/locations/page.tsx`)

Flat grid, unchanged in structure. `!ownerIdentifier` becomes
`ownerIdentifiers.length === 0`; the subtitle counts the merged total. No owner
grouping and no `owner_identifier` shown.

### Server actions (`src/lib/owner-directory/actions.ts`)

| Now | Becomes | Effect |
| --- | --- | --- |
| `manuallyLinkUser(userId, ownerIdentifier)` | `addOwnerLink(userId, ownerIdentifier)` | upsert row `source: "manual"`, `actorUserId` = admin |
| `manuallyUnlinkUser(userId)` | `revokeOwnerLink(userId, ownerIdentifier)` | upsert row `source: "revoked"`, `actorUserId` = admin |
| `resetUserLink(userId)` | `clearOwnerLink(userId, ownerIdentifier)` | delete the row — undoes a revoke *or* removes a manual link |

All three keep `requireAdmin()`, the
`{ ok: true } | { ok: false; error: string }` shape, and
`revalidatePath("/admin/owner-directory")`. All three are idempotent, so a
double-click is harmless.

"Upsert" means `onConflictDoUpdate` on the `(userId, ownerIdentifier)` unique
index, setting `source`, `actorUserId`, and `updatedAt` — so re-linking a
previously revoked owner flips one row rather than failing or duplicating.

Validation differs by direction, deliberately:

- **`addOwnerLink` validates**, as `manuallyLinkUser` does today: reject
  `UNKNOWN_OWNER`, and reject an identifier absent from `owner_locations`.
- **`revokeOwnerLink` and `clearOwnerLink` do not validate directory
  membership.** Revoking must work on an orphaned link — a link pointing at an
  identifier the sync has dropped is exactly the case an admin needs to clean
  up, and validating would block the cleanup.

`resetUserLink`'s bulk "reset this user" behavior is **deliberately dropped**.
Per-link clear covers it, and a bulk button meaning "delete all rows including
revocations" sitting beside a revoke button meaning the opposite is a footgun.

`listUsersWithLinks` becomes a left join on `user_owner_links`, grouped per user
in JS, each link carrying `{ ownerIdentifier, source }`. It does **not** join
`owner_locations` for the display name: that table has many rows per identifier,
so the join would need a distinct/aggregate for no benefit. The admin component
already receives `owners` from `listLinkableOwners`, so it resolves `ownerName`
from that list and derives `inDirectory` from presence in it — the orphan case
above needs no extra query.

`listLinkableOwners` is unchanged.

### Admin UI (`src/components/admin/OwnerDirectory.tsx`)

`UserLinkRow` renders the "Linked owners" cell as chips: identifier, source
badge (`auto` default / `manual` primary / `revoked` muted), and one action —
× to revoke for effective links, "undo" for revoked ones. Orphaned links carry a
muted "not in directory" note, which is what explains an owner's empty location
list.

Two fixes while in this file: the add-select's initial state becomes
`useState("")` rather than seeding from the user's single link
(`OwnerDirectory.tsx:208`), and its options exclude owners the user already has
an effective link to.

The section header gains the multi-link count.

## Migration

The DB is push-managed and prod serves the old code until the new deploy is
live, so dropping columns in the same change is a deploy-ordering hazard. Two
PRs:

- **PR 1** — add `user_owner_links`, backfill, move every read and write onto
  it. `users.owner_identifier` / `owner_link_source` remain in place, unread.
  Safe to roll back.
- **PR 2** — drop both columns, after PR 1 is verified in prod.

The backfill is a script under `scripts/` following the existing pattern
(`scripts/geocode-owner-locations.ts`). Its state mapping:

| Current user state | Backfill produces |
| --- | --- |
| `ownerIdentifier` set, source `auto` | one row, `source: "auto"` |
| `ownerIdentifier` set, source `manual` | one row, `source: "manual"` |
| `ownerIdentifier` null, source `manual` | a `revoked` row for **every** owner their normalized email currently matches, `UNKNOWN_OWNER` excluded |
| `ownerIdentifier` null, source null | no rows |

The third case is the subtle one: `manuallyUnlinkUser` writes
`ownerIdentifier: null, ownerLinkSource: "manual"`, which means "deliberately
unlinked, do not re-link me" — not "no link". Skipping it would auto-link a
deliberately-unlinked user on their next login, silently reversing an admin
decision. Writes go through `db.batch`.

## Error handling

- **Linker:** swallows everything, logs, never blocks sign-in (unchanged
  invariant).
- **Server actions:** `requireAdmin()` throws for non-admins; everything else
  returns `{ ok: false, error }`. Idempotent, so retries are safe.
- **Orphaned link** (identifier no longer in the directory): no crash — the
  location query simply returns fewer rows, and the admin UI labels the chip
  "not in directory".
- **Empty link set:** treated as "not an owner" everywhere — no query, no
  financials, `isOwner: false`.

## Testing

Gates: `npx tsc --noEmit` and `npx vitest run`. Not `next build` (the `.next`
lock on this Windows machine requires the dev server stopped); lint is excluded
as broken pre-existing.

- **`src/__tests__/owner-directory/link.test.ts`** — rewritten around
  `planOwnerLinks`. Table-driven over all seven reconciliation rows, plus two
  properties: **idempotency** (planning against the state a prior plan produced
  yields an empty plan) and **Austin's real case** (matched
  `["ut-lines-towns","ut-towns"]`, no existing links → both added, nothing
  skipped). Highest-value test in the change: a pure function over the exact
  reported bug.
- **`src/__tests__/kpi/owner-access.test.ts`** — extended for the array
  parameter: multi-membership allows; non-membership, `[]`, `null`, and
  `undefined` all block.
- **New — backfill mapping test.** The four-case table above is extracted as a
  pure function so it is testable without a DB, including the
  `null` + `manual` → revoke-everything case.
- **Updated** where they stub the old scalar:
  `src/__tests__/owner-directory/my-location.test.ts`,
  `src/__tests__/navigation.test.ts`, `src/__tests__/auth.test.ts`,
  `src/__tests__/listings/seller-locations.test.ts`.

## Out of scope

Two real problems this change does **not** fix, both source-data tasks:

1. **Lisa Lines still cannot see the co-owned locations.** No `ut-lines-towns`
   row carries Lisa's email, so the schema fix does nothing for them. Requires
   an `owner_contact_email` edit in Monday, or a manual link in the new admin
   UI.
2. **Austin's GA Alpharetta location stays invisible**, because it sits under
   `Unknown Owner`, which is unlinkable by design.
