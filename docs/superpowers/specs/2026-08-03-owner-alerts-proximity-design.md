# Owner Closure Alerts, Watch-This-Area, and Proximity-Sorted Competitor List

**Date:** 2026-08-03
**Status:** Approved by Parker (design sections reviewed 2026-08-03)
**Requested by:** Austin (pre-company-rollout feature batch)

## Purpose

Surface flagship-creation and relocation opportunities for salon owners by making
competitor-closure intelligence reach them proactively:

1. **Owner closure alerts** — owners get emailed when a competitor permanently
   closes within 3 miles of a salon they own, with a single one-time opt-in and
   zero configuration.
2. **Watch this area** — owners can click a salon they own and save a custom
   radius search around it (e.g. 5 miles), reusing the existing saved-search
   notification pipeline.
3. **Proximity-sorted competitor list** — the browse list view orders competitor
   closures by distance to the signed-in user's owned salons instead of raw
   database order.

## Background (what already exists)

- `alerts` is the saved-search table; it already supports `centerLat`/`centerLng`/
  `radiusMiles`/`centerLabel`, per-search `notifyEnabled`, and layer flags
  `includeListings`/`includeCompetitors` (`src/db/schema/alerts.ts`).
- A weekly cron (`/api/cron/competitor-alerts`, Tuesdays 03:00 UTC) emails users
  about new competitor closures matching their saved searches, deduped via
  `competitor_alert_log` (composite PK `alert_id` + `google_place_id`) and
  baseline-seeded at creation (`seedCompetitorLog`) so pre-existing closures
  never blast on first run.
- `competitor_opportunities` is scraper-owned (Railway `competitor-monitor`),
  strictly read-only, full-reconcile upserts/deletes by `google_place_id`.
  `businessStatus` is `'CLOSED_PERMANENTLY' | 'CLOSED_TEMPORARILY'` (text, not
  DB-enforced).
- Users link to owned salons via `user_owner_links` (sources `auto|manual|revoked`;
  effective = auto+manual) → `owner_locations`, which carries nullable
  `latitude`/`longitude`. `owner_locations` is full-refresh synced from BigQuery,
  so its row ids churn — references to it must be soft keys on
  `(owner_identifier, blvd_location_name)`.
- Login already runs `linkOwnerAtLogin` to reconcile owner links
  (`src/lib/owner-directory/login.ts`, wired in `src/auth.ts` signIn event).
- The competitor list (`src/components/browse/CompetitorList.tsx`) renders in raw
  Postgres row order — `getCompetitorClosures` has no `ORDER BY`.
- Delivery is email-only via Resend. There is no in-app notification system.
- Geo math is hand-rolled: `haversineMiles` / `isWithinRadius` / `boundingBox` in
  `src/lib/geo.ts`. No PostGIS.

## Feature 1: Automatic owner closure alerts

**Architecture: owner-auto alerts ARE saved searches** (approved over a separate
pipeline). Opting in creates one `alerts` row per owned salon; everything
downstream — cron, dedup ledger, email, My Alerts management — is reused.

### Schema changes (one hand-authored migration)

- `alerts.origin` — text, `'user'` (default) | `'owner-auto'`.
- `alerts.owner_identifier` — text, nullable. Soft reference.
- `alerts.owner_location_name` — text, nullable. Soft reference
  (`blvd_location_name`). Together with `owner_identifier` this identifies which
  owned salon an owner-auto search belongs to, surviving `owner_locations` id
  churn. Not FKs, matching the `user_owner_links` precedent.
- `users.owner_alerts_choice` — text, nullable. `null` = never prompted,
  `'enabled'`, `'declined'`.

The migration is written by hand (drizzle-kit generate has snapshot drift; the
prod `alerts` shape came from `db:push` and is not fully recorded in
migrations). **Verify the live Neon schema before authoring the migration.**

### Opt-in prompt

- Dismissible banner card: "Get notified when a competitor near one of your
  salons closes" with **Enable** / **No thanks**.
- Shown only to users with ≥1 effective linked owner location and
  `owner_alerts_choice IS NULL`.
- Placement: browse page and My Alerts (`/account/alerts`).
- Either choice stamps `owner_alerts_choice`; the prompt never reappears.

### What Enable creates

For each effective owned location **that has coordinates**:

- One `alerts` row: `origin='owner-auto'`, center = the salon's
  `owner_locations.latitude/longitude`, `radiusMiles = OWNER_AUTO_RADIUS_MILES`
  (new constant, **3**, kept in a server-only-free module), `includeCompetitors
  = true`, `includeListings = false`, `name` = the salon name, `centerLabel` =
  the salon name, `owner_identifier`/`owner_location_name` set.
- Ledger-seeded at creation via the existing `seedCompetitorLog` path, so
  closures that pre-date the opt-in are never emailed.
- Owned locations without coordinates are skipped (they can be picked up later
  by the reconciler once geocoded).

### Reconciler (login-time)

A new step appended to the existing login-time owner reconciliation, running
only when `owner_alerts_choice = 'enabled'`:

- **Create** owner-auto alerts (ledger-seeded) for effective owned locations
  with coords that have none.
- **Refresh** center coords and labels when the directory row changed.
- **Delete** owner-auto alerts whose `(owner_identifier, owner_location_name)`
  is no longer among the user's effective owned locations (covers admin
  revocations and directory removals).
- Reconciler failures must not block login (match the existing degrade-to-empty
  pattern in the session callback).

### Management semantics in My Alerts

- Owner-auto searches appear in their own "Your locations" group on
  `/account/alerts`.
- **No delete button** for owner-auto searches — the kill switch is the existing
  `notifyEnabled` toggle. This keeps the reconciler simple: it never has to
  distinguish "user deleted this" from "this is missing and should be created";
  a toggled-off row simply persists and stays silent.
- Radius is adjustable: the owner-auto card gets a small radius control (the
  only editable criterion), wired to the existing `updateAlert` action. 3 miles
  is the default, not a cage.

### Cron behavior

- One branch in `/api/cron/competitor-alerts`: alerts with `origin='owner-auto'`
  match **only** `businessStatus === 'CLOSED_PERMANENTLY'`. Regular saved
  searches keep today's both-types behavior.
- Email reuses the existing competitor-closure template; the subject includes
  the salon name (e.g. "Competitor closed 2.1 mi from Sugar House").

## Feature 2: Watch this area

### Entry points

1. **Map (owned Hello Sugar dots):** clicking an owned dot currently navigates
   straight to `/account/locations/[id]`. New behavior: open the standard HS
   location popup with two actions — **View location** (old behavior) and
   **Watch this area**. Owned salons that are actively listed for sale render on
   the listings layer and keep their existing click-through to the listing.
2. **Location detail page** (`/account/locations/[id]`): a **Watch this area**
   button. This covers listed locations and any case the map popup misses.

### Watch dialog

- Radius slider: 1–100 miles, default **5**.
- "Notify me about" choice: competitor closures / Hello Sugar listings for
  sale / both — **default competitors only**.
- Name field, defaulting to "Near {salon name}".
- Save creates a **normal** saved search: `origin='user'`, center = the salon's
  coords, `centerLabel` = salon name, deletable/editable like any other,
  ledger-seeded, both closure types (permanent-only applies to owner-auto
  searches, not these).
- Locations without coordinates: button disabled with an explanatory tooltip.

### Explicit scope step for ALL saved searches

The existing Save Search button on browse silently inherits the map layer
toggles into `includeListings`/`includeCompetitors` — unintuitive. It becomes a
small two-step popover: the same explicit "notify me about" checkboxes
(pre-checked from the current layer toggles) plus the existing name field, then
save. The checkbox group is one shared component used by both this popover and
the watch dialog so the two flows cannot drift. The existing guard stands: a
saved search must still have at least one real filter.

## Feature 3: Proximity-sorted competitor list

Server-side, in the browse page where competitor closures are already fetched
and the session is known. A new pure function in `src/lib/competitor-sort.ts`
annotates and sorts; precedence:

1. **Active searched center** (user searched a city + radius): sort by distance
   to that center, ascending — consistent with the listings "Nearest first"
   sort.
2. **Else, user has effective owned locations with coordinates:** annotate each
   closure with distance to the *nearest* owned salon (`haversineMiles`), sort
   ascending. The competitor card shows the annotation, e.g.
   "≈2.4 mi from Sugar House". Un-geocoded owned locations are skipped.
3. **Else:** `isOpportunity` first, then newest `closedAt` first (nulls last).

No new sort control in the UI — this is the automatic default order.

**Privacy boundary (DEBT-024):** owner coordinates must not enter the shared
`unstable_cache`d, owner-agnostic map queries. The distance computation happens
per-request in the page/server component using `getMyOwnerLocations()`.

Note: `competitor_opportunities.lat/lng` are `numeric` and arrive as strings —
coerce with `Number()` as existing callers do.

## Testing

Vitest units (patterns exist in `src/__tests__/`):

- Reconciler: create/refresh/delete matrix, notify-toggled-off rows untouched,
  revoked ownership removes auto-searches, failure does not throw into login.
- Cron: owner-auto alerts skip `CLOSED_TEMPORARILY`; regular alerts unaffected.
- `competitor-sort`: all three precedence tiers, nearest-of-many, missing
  coords, string lat/lng coercion, empty inputs.
- Save-scope step: the at-least-one-filter guard still holds; scope defaults
  derive from layer toggles.
- Opt-in action: creates rows only for coord-bearing locations, stamps choice,
  seeds ledger.

Per-step gate: `tsc` (stop the dev server before any `next build` on this
machine; lint is broken pre-existing). Email paths are untestable end-to-end
outside production without `EMAIL_OVERRIDE`.

## Rollout — three PRs, each branched from `origin/main`

1. **PR 1 — proximity sort** (feature 3): no schema, pure function + page
   wiring + card annotation.
2. **PR 2 — scope step + watch this area** (feature 2): shared scope component,
   SaveSearchButton popover, map popup change, detail-page button, watch
   dialog. No schema.
3. **PR 3 — owner closure alerts** (feature 1): migration, opt-in prompt +
   action, reconciler, cron branch, My Alerts grouping. Depends on nothing from
   PR 2 beyond merge-order convenience.

## Out of scope (deliberate)

- In-app notifications (email-only stands).
- Criteria-editing UI for saved searches beyond the owner-auto radius via
  `updateAlert`.
- Duplicate-saved-search detection.
- Any change to the scraper, `competitor_opportunities`, or `monitored_brands`.
- SMS/push delivery; unsubscribe tokens (per-search notify toggle stands).

## Open risks

- **Prod schema drift:** the migration must be authored against the verified
  live Neon shape, not the snapshots.
- **Coordinate coverage:** un-geocoded `owner_locations` silently degrade
  features 1–3 for those salons; worth a prod count before rollout.
- **Coordinate precision:** `coordSource` mixes Monday (source of truth) and
  MapTiler fallback; at a 3-mile threshold, fallback coords could
  include/exclude edge cases. Accepted.
- **Scraper churn:** a closure can be deleted (reopened) between cron email and
  user click-through; the email deep-links to `/browse`, which simply won't
  show it. Accepted (matches existing saved-search alert behavior).
