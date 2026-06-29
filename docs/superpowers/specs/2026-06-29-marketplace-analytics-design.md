# Marketplace Analytics — Design

**Date:** 2026-06-29
**Status:** Approved (design); pending spec review before planning
**Author:** parker.fellows@hellosugar.salon (with Claude)

## Overview

Add visibility analytics in two places:

1. **Admin → Analytics tab** (admins only): per-user logins and activity, with summary
   cards, a 30-day trend chart, and a sortable user table.
2. **Public listing page** (`/listings/[id]`, any signed-in user): a Zillow-style stat
   strip showing **Days listed · Views · Saves**.

Both ride on a small amount of new tracking instrumentation. Activity is reported as
**aggregate stats** (not a per-action timeline). Most "activity" numbers come from data
already captured today (`favorites`, `contacts`, `listings`); the net-new tracking is
**logins**, **views**, and a **listed-at** timestamp.

### Key decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Admin activity depth | Aggregate stats only (no full activity feed, no page-level analytics) |
| View counting | **Unique per viewer per day** — refreshes don't inflate; repeat interest across days does |
| Days listed counts from | **First go-live** (status → `active`); existing active listings backfilled from `createdAt` |
| Public stats placement | **Listing page only** (Version A stat strip). Browse cards stay clean. |
| Admin tab scope | **Option B** — summary cards + 30-day trend chart + sortable table with per-user sparkline |
| Login trend source | Dedicated `login_events` table (one row per login) for an accurate day-by-day chart |
| Viewer identity | Logged-in `userId` — the marketplace is fully behind Google sign-in + allowlist, so no anonymous-cookie handling is needed |

## Data model

Drizzle ORM on Neon Postgres. Per project convention the DB is **push-managed**
(`drizzle-kit push`), not migration-file-managed. New schema files live under
`src/db/schema/` and are re-exported from `src/db/schema.ts`.

### Changes to existing tables

**`listings`** (`src/db/schema/listings.ts`)
- Add `listedAt timestamp` (nullable) — set the first time status becomes `active`; never
  overwritten afterward. Powers "days listed."
- Keep existing `viewCount integer` and `inquiryCount integer` as denormalized fast-read
  counters (see write paths below).

**`users`** (`src/db/schema/auth.ts`)
- Add `loginCount integer default 0 not null`.
- Add `lastLoginAt timestamp` (nullable).
  (These are denormalized conveniences; `login_events` below is the source of truth for
  the trend chart. Both are written on each login.)

### New table: `listing_views`

New file `src/db/schema/listingViews.ts`. Powers the "unique per day" view metric.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()` default, matching existing tables |
| `listingId` | text NOT NULL | FK → `listings.id`, `onDelete: cascade` |
| `viewerId` | text NOT NULL | FK → `users.id`, `onDelete: cascade` |
| `viewDate` | date NOT NULL | calendar date only (no time-of-day) |
| `createdAt` | timestamp default now NOT NULL | |

- **Unique index** on `(listingId, viewerId, viewDate)` — at most one row per viewer per
  listing per day.
- Displayed view total for a listing = count of rows for that `listingId` (equivalently
  the denormalized `listings.viewCount`).

### New table: `login_events`

New file `src/db/schema/loginEvents.ts`. Powers the 30-day trend chart and "active this
week."

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `crypto.randomUUID()` default |
| `userId` | text NOT NULL | FK → `users.id`, `onDelete: cascade` |
| `createdAt` | timestamp default now NOT NULL | one row per successful login |

- Index on `createdAt` (trend queries) and on `userId` (per-user rollups).

### Derived (no new storage)

- **Saves made** by a user → `favorites` where `userId = user`.
- **Reach-outs sent** by a user → `contacts` where `buyerId = user`.
- **Inquiries received** by a user → `contacts` joined to `listings` where
  `listings.sellerId = user`.
- **Listings posted** by a user → `listings` where `sellerId = user`.
- **Saves on a listing** (public strip) → `favorites` where `listingId = listing`.

## Write paths (where tracking is recorded)

1. **Views** — a server action (e.g. `recordListingView(listingId)`) invoked on
   `/listings/[id]` load.
   - No-op if the viewer is the listing's own `sellerId` or has role `admin`.
   - Insert into `listing_views` with `onConflictDoNothing` on the unique index.
   - Increment `listings.viewCount` **only when a row was actually inserted** (new
     viewer-day), via `sql` increment. Keeps the public read a single integer.

2. **Logins** — in the NextAuth `signIn` event callback (`src/auth.ts`):
   - Insert a `login_events` row.
   - Increment `users.loginCount` and set `users.lastLoginAt = now()`.

3. **`listedAt`** — in the listing status-transition code, at the point status moves to
   `active`: set `listedAt = now()` only if currently null (set-once).

## Public listing page — stat strip (Version A)

In `src/app/listings/[id]/page.tsx`:

- Add a 3-up stat strip directly under the price: **Days listed · Views · Saves**.
  - Bordered rounded container, three equal cells, large bold number + uppercase label,
    red-accent (`--hs-red-600` = `#dc2626`) icons (calendar / eye / heart).
- **Days listed** = whole days between `listedAt` (fallback `createdAt`) and today;
  renders as `New` when 0 (the big-number cell shows the word "New" rather than a count).
- **Views** = `listings.viewCount`.
- **Saves** = count of `favorites` for the listing.
- **Remove** the existing small gray "views / inquiries" pills near the title (lines
  ~96–112) so there is a single, clean stats display.
- Browse cards (`src/components/browse/ListingCard.tsx`) are **not** changed.

## Admin → Analytics tab (Option B)

- **Nav:** add `{ label: "Analytics", href: "/admin/analytics" }` to `ADMIN_NAV` in
  `src/lib/navigation.ts`.
- **Route:** `src/app/admin/analytics/page.tsx`, admin-gated exactly like the other admin
  pages (`session.user.role !== "admin"` → redirect). Data fetched in a server
  `actions.ts` alongside the page, mirroring `src/app/admin/users/`.
- **Summary cards:** Total users · Active this week (distinct `login_events.userId` in last
  7 days) · Logins (30d, count of `login_events`) · Inquiries (30d, count of `contacts`).
- **Trend chart:** recharts line/area chart of daily login counts over the last 30 days
  (from `login_events`).
- **User table** (client component for sort/search; data from server):
  columns **User · Role · Logins · Last active · Listings · Reach-outs sent · Inquiries
  received · Saves**, plus a small per-user activity sparkline.
  - All columns sortable; name/email/role search; rows link to a per-user detail view.
  - Cells that don't apply to a user render as `—`.
- **Per-user detail view** (`/admin/analytics/[userId]`): the same numbers for one user,
  expanded. (Lightweight; reuses the aggregation queries.)
- A small note on the tab clarifies that logins/views accrue **from launch** (no
  historical backfill), so early numbers are expected to be low.

## Backfill & rollout

- One-time backfill: set `listings.listedAt = createdAt` for all listings currently in
  `active` status (and reasonably for `sold`/`delisted` that were once active — use
  `createdAt`).
- `login_events`, `listing_views`, `loginCount`, `lastLoginAt`, and `viewCount` start
  empty/zero and accrue from deploy. No historical reconstruction is possible or attempted.

## Testing

Vitest (existing setup). Unit-test the pure logic and query builders:

- **View dedup:** same user + same listing + same day → 1 row / count 1; same user next
  day → count 2; seller's own view → not counted; admin view → not counted.
- **`listedAt` set-once:** transition to `active` sets it; a later transition does not
  overwrite it.
- **Days-listed math:** 0 → renders "New"; correct whole-day count across a boundary.
- **Aggregations:** per-user reach-outs sent / inquiries received / saves / listings;
  active-this-week and 30-day login counts.

## Out of scope (YAGNI)

- Per-action activity feed / timeline per user.
- Page-level / click-path analytics (use a dedicated analytics tool if ever needed).
- Stats on browse cards (explicitly chosen to keep cards clean).
- Anonymous/guest viewer tracking (marketplace is fully authenticated).
