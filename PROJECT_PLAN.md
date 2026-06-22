---
project: HS Marketplace
goal: Take the Hello Sugar selling marketplace from its current V1 build through V2 (real Boulevard + Places data, alerts, production hardening).
start_date: 2026-06-17
cadence: ~6h/weekday (full-time)
created: 2026-06-17
last_audited: 2026-06-22
---

# HS Marketplace — Project Plan

> Take the Hello Sugar selling marketplace from its current V1 build through V2: real Boulevard + Google Places data, working alerts, and production hardening — by end of month.

**Reality check (2026-06-17):** A repo audit shows **most of V1 is already built** — Google auth + allowlist, listings CRUD with approval workflow, map browse + Haversine radius search, listing detail with KPI charts, contact flow, favorites, alerts CRUD, Resend email templates, and admin/seller UIs are all in place. KPIs run on **mock data**. This plan is therefore weighted toward (1) de-risking Boulevard — still the single biggest unknown, (2) closing two known V1 gaps (geocoding backfill, alert-trigger wiring), (3) the V2 real-data integrations, and (4) production hardening.

**Timeline is aggressive.** Through-V2 in 10 working days (Jun 17 → Jun 30) is only realistic *because* V1 is done. The hard dependency is **Boulevard API access** (blocked on Austin). If that slips, Phase 2 slips — the Boulevard tasks below are flagged `blocked`-eligible, and V1 ships independently of them in Phase 1.

---

## Phase 0: De-risk & verify (Jun 17–18)
- [x] **T-01** Live-data source spike — confirm access and pullable metrics — _Day 1, due 2026-06-17_
  - _Done when:_ Real per-location **Net Sales (YTD)** + **MCR** can be pulled from the chosen source. **Outcome:** Boulevard's Admin API proved non-functional, so the spike pivoted to **BigQuery** (Prince's data mart). Access confirmed, both metrics return real per-location data, and the MCR definition (new members ÷ prospects, laser excluded) is documented. Supersedes the original Boulevard spike.
- [x] **T-02** Verify map + radius search end-to-end against geocoded data — _~2h, due 2026-06-18_
  - _Done when:_ `npm test` passes (geo unit tests green) and a manual `/browse` radius search returns the expected listings against seeded/geocoded data.
- [x] **T-03** Security audit of git history + rotate any leaked secrets — _~2h, due 2026-06-18_
  - _Done when:_ Git history scanned for committed OAuth secrets / DB URLs / API keys (the repo was public on a personal account); anything found is rotated and confirmed removed from active use. Manual — judgment + external dashboards.

## Phase 1: Close V1 gaps & ship internally (Jun 18–22)
- [x] **T-04** Run geocoding backfill in production — _~2h, due 2026-06-18_
  - _Done when:_ `geocode-locations.ts` has been run against prod; a `--dry-run` reports **0** remaining salon locations with `latitude IS NULL` (all listed salons have coordinates). Depends on T-03 (use rotated/correct `MAPTILER_API_KEY`).
- [x] **T-05** Wire alert-matching trigger into listing approval — _~2h, due 2026-06-19_
  - _Done when:_ `approveListing` (or the active-transition path) calls `triggerAlertMatching`, so approving a listing fires matching saved-search alerts. Verified by an approval producing a sent alert email in dev.
- [x] **T-06** Access-control audit on financial data — _~3h, due 2026-06-19_
  - _Done when:_ Confirmed (with a regression test or documented review) that sales/profitability/TTM fields are **only** exposed for `active` listings whose seller opted in — never leaked for draft/pending/unlisted locations via any query or API route. The #1 production correctness concern.
- [x] **T-07** Full end-to-end QA pass of the V1 flow — _~3h, due 2026-06-22_
  - _Done when:_ A documented run-through confirms: seller creates a listing → admin approves → a second user finds it by map/radius → views detail → submits a contact inquiry → seller receives the email. Manual.
- [ ] **T-08** Deploy V1 to Vercel and confirm internal access — _~2h, due 2026-06-22_
  - _Done when:_ Production deployment is live, Google login works for a `hellosugar.salon` account, and an allowlisted non-workspace user can sign in. Manual — verified against the live URL.

## Phase 2: V2 — real data (Jun 23–26)
- [x] **T-09** Build BigQuery client module (client + Net Sales/MCR queries + name-match mapper) — _Day 1, due 2026-06-23_
  - _Done when:_ `src/lib/bigquery/` contains a typed, server-only client + cached daily Net Sales (YTD) and MCR queries (dollars→cents), and `src/lib/data/` holds the source-agnostic name-match + mapping logic, all with passing unit tests. Replaces the original Boulevard client (deleted). Depends on T-01.
- [x] **T-10** Wire BigQuery data into listing KPIs (Net Sales YTD + MCR) — _Day 1, due 2026-06-24_
  - _Done when:_ The KPI fetch layer pulls **real** Net Sales (YTD) + MCR from BigQuery for active, confirmed-mapped locations; **profitability stays a manual field**; New Clients/Bookings tiles hidden. Listing detail shows live numbers behind the `active + confirmed` gate. Depends on T-09.
- [ ] **T-11** Build Google Places client (reviews + business_status, cached) — _Day 1, due 2026-06-25_
  - _Done when:_ `src/lib/places/` fetches Google reviews and `business_status` by Place ID, with aggressive caching (results not re-fetched per request) and a Zod-validated mapper. Lays groundwork for V3 closure detection.
- [ ] **T-12** Wire Places reviews into listing detail — _~3h, due 2026-06-26_
  - _Done when:_ Listing detail displays Google review count/rating sourced from the cached Places layer, not mock data. Depends on T-11.
- [x] **T-13** Verify saved-search email alerts end-to-end — _~3h, due 2026-06-26_
  - _Done when:_ Approving a new listing that matches a saved search reliably sends the Resend alert email, covered by an integration test. Depends on T-05.

## Phase 3: Production-readiness (Jun 29–30)
- [ ] **T-14** Data-mapper test coverage (BigQuery + Places + geo) — _~3h, due 2026-06-29_
  - _Done when:_ `npm test` passes and includes tests for the BigQuery mapper (Net Sales/MCR + name-match), the Places mapper, and the existing geospatial query — the three integration points most likely to break silently. _In progress:_ BigQuery + geo covered; Places mapper pending T-11. Depends on T-09, T-11.
- [ ] **T-15** Add Sentry + structured logging — _~3h, due 2026-06-29_
  - _Done when:_ `@sentry/nextjs` is installed and capturing errors in server actions + API routes, and key operations emit structured logs. Verified by a test error appearing in Sentry.
- [ ] **T-16** Places API cost controls (cache + billing budget/alert) — _~2h, due 2026-06-30_
  - _Done when:_ Places results are cached and only refreshed deliberately (not per radius search), and a Google Cloud billing budget + alert is configured. Cache code is repo-checkable; the budget is manual.
- [ ] **T-17** Cron reliability hardening (idempotent + logged + failure alert) — _~2h, due 2026-06-30_
  - _Done when:_ The reminders cron logs every run, is safe to re-run (idempotent), and alerts on failure — so a silently-dead job is impossible.
- [x] **T-18** Verify backups + secrets posture — _~1h, due 2026-06-30_
  - _Done when:_ Neon point-in-time recovery / branching is confirmed enabled, and all secrets are confirmed to live in Vercel project env (none in the repo). Manual — verified against Neon + Vercel dashboards.

---
## Task Ledger
<!-- Machine-readable source of truth for project-audit. The checklist above is
     the readable view; this carries the real status. If they disagree, this
     wins. You can hand-edit checkboxes freely — the audit reconciles. -->
```json
{
  "tasks": [
    {
      "id": "T-01",
      "title": "Live-data source spike — confirm access and pullable metrics (BigQuery, replaced Boulevard)",
      "phase": "De-risk & verify",
      "estimate": "Day 1",
      "due": "2026-06-17",
      "done_when": "Real per-location Net Sales (YTD) + MCR pullable from the chosen source. Outcome: Boulevard Admin API non-functional, pivoted to BigQuery; access confirmed, both metrics return real data, MCR definition (new members / prospects, laser excluded) documented.",
      "check": { "type": "manual", "note": "Pivot from Boulevard to BigQuery confirmed; BigQuery queries return real per-location Net Sales + MCR. See src/lib/bigquery/queries.ts." },
      "status": "done"
    },
    {
      "id": "T-02",
      "title": "Verify map + radius search end-to-end against geocoded data",
      "phase": "De-risk & verify",
      "estimate": "~2h",
      "due": "2026-06-18",
      "done_when": "npm test passes (geo unit tests green) and a manual /browse radius search returns expected listings against seeded/geocoded data.",
      "check": { "type": "command", "run": "npm test" },
      "status": "done"
    },
    {
      "id": "T-03",
      "title": "Security audit of git history + rotate any leaked secrets",
      "phase": "De-risk & verify",
      "estimate": "~2h",
      "due": "2026-06-18",
      "done_when": "Git history scanned for committed secrets (repo was public on a personal account); anything found rotated and confirmed out of use.",
      "check": { "type": "manual", "note": "Requires inspecting git history and rotating credentials in external dashboards. Marked resolved per user direction 2026-06-22 (for the time being)." },
      "status": "done"
    },
    {
      "id": "T-04",
      "title": "Run geocoding backfill in production",
      "phase": "Close V1 gaps & ship internally",
      "estimate": "~2h",
      "due": "2026-06-18",
      "done_when": "geocode-locations.ts run against prod; --dry-run reports 0 remaining salon locations with latitude IS NULL.",
      "check": { "type": "command", "run": "npx tsx scripts/geocode-locations.ts --dry-run", "note": "Marked resolved per user direction 2026-06-22 (for the time being)." },
      "status": "done"
    },
    {
      "id": "T-05",
      "title": "Wire alert-matching trigger into listing approval",
      "phase": "Close V1 gaps & ship internally",
      "estimate": "~2h",
      "due": "2026-06-19",
      "done_when": "approveListing (or the active-transition path) calls triggerAlertMatching; approving a listing fires matching saved-search alert emails in dev.",
      "check": { "type": "grep", "pattern": "triggerAlertMatching", "path": "src/lib/admin/actions.ts" },
      "status": "done"
    },
    {
      "id": "T-06",
      "title": "Access-control audit on financial data",
      "phase": "Close V1 gaps & ship internally",
      "estimate": "~3h",
      "due": "2026-06-19",
      "done_when": "Confirmed via regression test or documented review that sales/profitability/TTM are exposed only for active, opted-in listings — never for draft/pending/unlisted locations.",
      "check": { "type": "manual", "note": "Review every query/route that returns financial fields; ideally back with a test asserting non-active listings hide financials. Marked resolved per user direction 2026-06-22 (for the time being)." },
      "status": "done"
    },
    {
      "id": "T-07",
      "title": "Full end-to-end QA pass of the V1 flow",
      "phase": "Close V1 gaps & ship internally",
      "estimate": "~3h",
      "due": "2026-06-22",
      "done_when": "Documented run-through: seller creates listing -> admin approves -> second user finds by radius -> views detail -> contacts -> seller gets email.",
      "check": { "type": "manual", "note": "Manual click-through of the full marketplace flow. Marked resolved per user direction 2026-06-22 (for the time being)." },
      "status": "done"
    },
    {
      "id": "T-08",
      "title": "Deploy V1 to Vercel and confirm internal access",
      "phase": "Close V1 gaps & ship internally",
      "estimate": "~2h",
      "due": "2026-06-22",
      "done_when": "Production deployment live; Google login works for a hellosugar.salon account and an allowlisted non-workspace user can sign in.",
      "check": { "type": "manual", "note": "Verify against the live Vercel URL with two account types." },
      "status": "not_started"
    },
    {
      "id": "T-09",
      "title": "Build BigQuery client module (client + Net Sales/MCR queries + name-match mapper)",
      "phase": "V2 — real data",
      "estimate": "Day 1",
      "due": "2026-06-23",
      "done_when": "src/lib/bigquery/ has a typed server-only client + cached daily Net Sales (YTD) and MCR queries (dollars->cents); src/lib/data/ holds source-agnostic name-match + mapping logic; all with passing unit tests. Replaces the deleted Boulevard client.",
      "check": { "type": "grep", "pattern": "getNetSalesByLocation|getMcrByLocation", "path": "src/lib/bigquery" },
      "status": "done"
    },
    {
      "id": "T-10",
      "title": "Wire BigQuery data into listing KPIs (Net Sales YTD + MCR)",
      "phase": "V2 — real data",
      "estimate": "Day 1",
      "due": "2026-06-24",
      "done_when": "KPI fetch layer pulls real Net Sales (YTD) + MCR from BigQuery for active, confirmed-mapped locations; profitability stays manual; New Clients/Bookings tiles hidden; listing detail shows live numbers behind the active+confirmed gate.",
      "check": { "type": "grep", "pattern": "bigquery", "path": "src/lib/kpi/fetch.ts" },
      "status": "done"
    },
    {
      "id": "T-11",
      "title": "Build Google Places client (reviews + business_status, cached)",
      "phase": "V2 — real data",
      "estimate": "Day 1",
      "due": "2026-06-25",
      "done_when": "src/lib/places/ fetches reviews and business_status by Place ID with aggressive caching and a Zod-validated mapper.",
      "check": { "type": "grep", "pattern": "business_status", "path": "src/lib/places" },
      "status": "not_started"
    },
    {
      "id": "T-12",
      "title": "Wire Places reviews into listing detail",
      "phase": "V2 — real data",
      "estimate": "~3h",
      "due": "2026-06-26",
      "done_when": "Listing detail shows Google review count/rating from the cached Places layer, not mock data.",
      "check": { "type": "grep", "pattern": "places", "path": "src/lib/listing-detail.ts" },
      "status": "not_started"
    },
    {
      "id": "T-13",
      "title": "Verify saved-search email alerts end-to-end",
      "phase": "V2 — real data",
      "estimate": "~3h",
      "due": "2026-06-26",
      "done_when": "Approving a new matching listing reliably sends the Resend alert email, covered by an integration test.",
      "check": { "type": "grep", "pattern": "sendAlertMatchEmail", "path": "src" },
      "status": "done"
    },
    {
      "id": "T-14",
      "title": "Data-mapper test coverage (Boulevard + Places + geo)",
      "phase": "Production-readiness",
      "estimate": "~3h",
      "due": "2026-06-29",
      "done_when": "npm test passes and includes tests for the BigQuery mapper (Net Sales/MCR + name-match), the Places mapper, and the geospatial query.",
      "check": { "type": "command", "run": "npm test" },
      "status": "in_progress"
    },
    {
      "id": "T-15",
      "title": "Add Sentry + structured logging",
      "phase": "Production-readiness",
      "estimate": "~3h",
      "due": "2026-06-29",
      "done_when": "@sentry/nextjs installed and capturing errors in server actions + API routes; key operations emit structured logs; a test error appears in Sentry.",
      "check": { "type": "grep", "pattern": "@sentry/nextjs", "path": "src" },
      "status": "not_started"
    },
    {
      "id": "T-16",
      "title": "Places API cost controls (cache + billing budget/alert)",
      "phase": "Production-readiness",
      "estimate": "~2h",
      "due": "2026-06-30",
      "done_when": "Places results cached and refreshed deliberately (not per radius search); Google Cloud billing budget + alert configured.",
      "check": { "type": "manual", "note": "Cache code is repo-checkable, but the billing budget/alert must be verified in Google Cloud console." },
      "status": "not_started"
    },
    {
      "id": "T-17",
      "title": "Cron reliability hardening (idempotent + logged + failure alert)",
      "phase": "Production-readiness",
      "estimate": "~2h",
      "due": "2026-06-30",
      "done_when": "The reminders cron logs every run, is idempotent, and alerts on failure.",
      "check": { "type": "grep", "pattern": "console|logger|captureException", "path": "src/app/api/cron/reminders/route.ts" },
      "status": "not_started"
    },
    {
      "id": "T-18",
      "title": "Verify backups + secrets posture",
      "phase": "Production-readiness",
      "estimate": "~1h",
      "due": "2026-06-30",
      "done_when": "Neon point-in-time recovery/branching confirmed enabled; all secrets confirmed in Vercel env, none in the repo.",
      "check": { "type": "manual", "note": "Verify against Neon and Vercel dashboards. Marked resolved per user direction 2026-06-22 (for the time being)." },
      "status": "done"
    }
  ]
}
```
