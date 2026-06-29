# Competitor-Aware Search & Alerts — Design

**Date:** 2026-06-29
**Status:** Approved design, pending implementation plan
**Author:** Brainstormed with Claude Code

## Summary

Make competitor closures first-class in the browse experience and the alerts
system. Four connected changes:

1. **Competitors respect the geographic filters** — the center+radius search and
   the state dropdown now narrow competitor closures on the map and list, just as
   they narrow Hello Sugar listings.
2. **The two map toggles move into the top filter bar** — "Hello Sugar locations"
   and "Competitors" become filter-bar toggles (nuqs URL state) instead of
   buttons overlaid on the map, and their values are persisted onto a saved
   search.
3. **The toggles gate alerts** — a saved search only sends listing alerts when its
   Hello Sugar toggle was on, and only sends competitor alerts when its competitor
   toggle was on.
4. **A new competitor-alert pipeline** — a weekly cron detects competitors newly
   added by the scraper that fall inside a saved search's geographic scope and
   emails the search owner a digest, using a new email template.

## Goals

- Competitor closures honor the radius/center search and the state filter.
- Move both visibility toggles into the filter bar; persist them on the saved
  search (`alerts` row).
- Send competitor-closure alerts for saved searches that opted in, triggered by
  an app-owned weekly scan (no dependency on the external scraper calling us).
- Gate listing alerts on the Hello Sugar toggle.

## Non-goals

- No change to *how* the external `competitor-monitor` scraper writes
  `competitor_opportunities`; the app remains read-only on that table.
- No near-real-time alerting; weekly cadence only.
- Competitors are not filtered by price, listing type, or years-open (these are
  listing-only attributes).
- No new competitor data fields, no competitor detail pages.

## Decisions (from brainstorming)

- **Trigger:** app-side Vercel Cron scan (decoupled from the scraper).
- **Competitor filters:** radius/center **and** state. Not price/type/years/text.
- **HS toggle:** gates listing alerts (symmetric with the competitor toggle).
- **Email:** one digest per saved search per run.
- **Cron cadence:** weekly, Monday evening US (after the Monday scraper run).
- **Recipients:** the saved-search owner.
- **New-search toggle defaults:** both on.

## Data model changes

Applied via `drizzle-kit push` (project's push-managed Neon setup; see project
memory on DB migration state).

### `alerts` table — two new columns

- `includeListings boolean NOT NULL DEFAULT true`
- `includeCompetitors boolean NOT NULL DEFAULT true`

These are the persisted form of the two filter-bar toggles. `notifyEnabled`
remains the master email on/off for the whole saved search.

### New table `competitor_alert_log`

The per-search ledger of competitors already accounted for — both ones we have
emailed and ones seeded as a baseline. Makes "new" reliable without trusting the
scraper's `syncedAt` (which is rewritten on every reconcile).

```
competitor_alert_log
  alert_id        uuid/text  NOT NULL  REFERENCES alerts(id) ON DELETE CASCADE
  google_place_id text       NOT NULL
  alerted_at      timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (alert_id, google_place_id)
```

(Match `alert_id`'s type to `alerts.id`'s actual column type in the schema.)

## Part 1 — Competitors respect radius + state

`getCompetitorClosures()` in `src/lib/competitor-query.ts` becomes
`getCompetitorClosures(filters)` accepting
`{ centerLat?: number; centerLng?: number; radiusMiles?: number; states?: string[] }`.

- When `centerLat/centerLng/radiusMiles` are all present: apply the same
  two-stage geo approach listings use — a bounding-box prefilter
  (`boundingBox()` from `src/lib/geo.ts`) in SQL, then precise Haversine
  trimming (`haversineMiles()`), keeping competitors whose `(lat, lng)` is within
  `radiusMiles`.
- When `states` is non-empty: add `state IN (...)`.
- When no geo and no states: behavior unchanged (all rows), preserving today's
  default browse view.
- Price/type/years/text filters are ignored for competitors.

`BrowseContent` (`src/app/browse/page.tsx`) passes the already-parsed filter
object to `getCompetitorClosures(filters)`, so competitors re-fetch server-side
on filter change exactly like listings (the page already re-renders on nuqs URL
changes with `shallow: false`).

*Alternative considered:* filter the preloaded competitor array client-side.
Rejected — inconsistent with how listings filter and would duplicate/diverge the
radius math.

## Part 2 — Toggles move into the filter bar

- Remove the two `absolute`-positioned overlay buttons (currently in
  `BrowsePage.tsx` ~lines 402–467) and their local `showListings` /
  `showCompetitors` `useState`.
- Add `showListings` and `showCompetitors` as **nuqs boolean params**
  (`parseAsBoolean.withDefault(true)`) in `useListingFilters()`
  (`src/components/browse/FilterBar.tsx`), and render two toggle controls in
  `FilterBar`.
- `MapView` reads visibility from filter state (props derived from the nuqs
  filters) instead of the removed local props. The competitor toggle still hides
  competitor pins/list when off; the underlying fetch still runs (cheap), so
  toggling is instant.
- `SaveSearchButton` already serializes the nuqs filter state into `createAlert`.
  Map `showListings` → `includeListings` and `showCompetitors` →
  `includeCompetitors` in the `AlertInput` payload and the `createAlert` insert.
- `listMode` (which dataset the left list shows) stays as-is; only the two
  visibility toggles move and gain persistence.

## Part 3 — Listing alerts gated by the Hello Sugar toggle

In `triggerAlertMatching(listing)` (`src/lib/alert-actions.ts`), add one
condition to the existing AND-chain: a listing match also requires
`alert.includeListings === true`. No other change to the approval-time flow.

## Part 4 — Competitor alert cron pipeline

### Route & schedule

- New route handler `src/app/api/cron/competitor-alerts/route.ts`.
- Weekly Vercel Cron entry (in `vercel.json`):
  `{ "path": "/api/cron/competitor-alerts", "schedule": "0 3 * * 2" }`.
  `0 3 * * 2` = Tuesday 03:00 UTC = Monday evening across US timezones (~8 PM
  MST/AZ, ~10 PM ET, ~7 PM PT), after the Monday scraper run. Exact time tunable
  in `vercel.json`.
- **Auth:** the handler verifies the `Authorization` header equals
  `Bearer ${process.env.CRON_SECRET}` (Vercel sends this for cron invocations);
  reject otherwise with 401. Add `CRON_SECRET` to env config.

### Per-run logic

For each alert where `notifyEnabled === true && includeCompetitors === true`:

1. **Scope:** compute the alert's competitor matches using the same geo+state
   logic as Part 1 (`getCompetitorClosures({ centerLat, centerLng, radiusMiles,
   states })`). A saved search with **neither** a center+radius **nor** any
   states is **skipped** (no way to scope competitors — would match everything).
2. **New selection:** of the matched `googlePlaceId`s, keep those **not present**
   in `competitor_alert_log` for this `alertId`.
3. **Notify:** if the new set is non-empty, send one digest email
   (`sendCompetitorAlertEmail`) to the search owner, then insert the new
   `googlePlaceId`s into `competitor_alert_log`.

### Baseline seeding (prevents first-run flood)

- On `createAlert` when `includeCompetitors === true`: insert
  `competitor_alert_log` rows for **all currently-matching** competitor
  `googlePlaceId`s, *without sending email*. So only competitors that appear
  after the search is saved will ever alert.
- On `updateAlert` when `includeCompetitors` flips `false → true`: seed the same
  way. When it flips `true → false`, leave the log as-is (harmless; re-enabling
  won't re-flood because rows remain).

### Idempotency & ordering

- Log rows are written **after** a successful email send. A crash between send
  and write risks a duplicate digest on the next weekly run — preferred over the
  opposite ordering, which could drop an alert entirely.
- `INSERT ... ON CONFLICT (alert_id, google_place_id) DO NOTHING` so re-seeding
  or overlap is safe.

## Email

New `sendCompetitorAlertEmail(data)` in `src/lib/email.ts`, following the
existing `sendAlertMatchEmail` inline-HTML style and the same from-address /
non-prod logging fallback.

```
CompetitorAlertData = {
  buyerEmail: string
  buyerName: string | null
  searchName: string            // alert.name or generated label
  searchUrl: string             // re-applies the saved search filters
  competitors: Array<{
    brandName: string
    city: string | null
    state: string | null
    nearestHsName: string | null
    nearestHsMiles: number | null
    mapsUrl: string | null
  }>
}
```

Body: heading naming the saved search, a list of the new competitor closures
(brand — city, state; "nearest Hello Sugar: X (N mi)"; Google Maps link), a link
back to the saved search, and the existing unsubscribe → `/account/alerts`
footer.

## Error handling & resilience

- Empty or unavailable `competitor_opportunities` → cron no-ops gracefully
  (mirrors `getCompetitorClosures`'s existing empty-on-failure behavior).
- Per-alert failures (email send, query) are caught and logged; the run
  continues to the next alert. The handler returns a summary
  (`{ processed, emailed, errors }`) and 200 unless auth fails.
- Email send failures use the existing Resend fallback (logged, not thrown).

## Testing

Vitest, node env, pure functions under `src/__tests__/**/*.test.ts`
(`server-only` mocked), per repo convention. Components are not unit-tested (no
RTL).

- **Competitor geo+state filter:** a pure filter function over fixture
  competitor rows — in-range vs out-of-range by Haversine; state match; the
  no-geo-no-state passthrough.
- **New-competitor selection:** pure function — given matched competitors and a
  set of already-logged `googlePlaceId`s, returns only the new ones; empty when
  all are logged.
- **Baseline seeding:** `createAlert` with `includeCompetitors` inserts log rows
  for all currently-matching competitors and sends no email.
- **Listing-alert gating:** `triggerAlertMatching` sends only when
  `includeListings` is true (extend existing alert-matching tests).
- **Competitor email:** `sendCompetitorAlertEmail` renders each competitor and
  the search link (assert on the produced HTML string).

## Files touched

| File | Change |
| --- | --- |
| `src/db/schema/alerts.ts` | Add `includeListings`, `includeCompetitors` columns |
| `src/db/schema/competitorAlertLog.ts` | New table schema |
| `src/lib/competitor-query.ts` | `getCompetitorClosures(filters)` geo+state filtering |
| `src/app/browse/page.tsx` | Pass filters into `getCompetitorClosures` |
| `src/components/browse/FilterBar.tsx` | Add `showListings`/`showCompetitors` nuqs params + toggle UI |
| `src/components/browse/BrowsePage.tsx` | Remove overlay buttons + local toggle state; derive from filters |
| `src/components/browse/MapView.tsx` | Read visibility from filter-derived props |
| `src/components/browse/SaveSearchButton.tsx` | Include toggles in `createAlert` payload |
| `src/lib/alert-actions.ts` | `includeListings`/`includeCompetitors` in create/update; gate listing match; baseline-seed competitor log; new-competitor selection helper |
| `src/app/api/cron/competitor-alerts/route.ts` | New cron handler (auth + per-alert scan) |
| `src/lib/email.ts` | New `sendCompetitorAlertEmail` |
| `vercel.json` | Weekly cron entry |
| `src/env` config | Add `CRON_SECRET` |
| (tests) | Filter, selection, seeding, gating, email |

## Assumptions

- `alerts.id` type is reused for `competitor_alert_log.alert_id`.
- Vercel Cron is available on the project's plan for weekly schedules.
- The scraper continues to UPSERT by `googlePlaceId` and the app never writes
  `competitor_opportunities`.
