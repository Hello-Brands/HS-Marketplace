# Technical Debt Register

**Project:** HS-Marketplace
**Last Updated:** 2026-07-06 (remediation session — all 22 open items worked; see Remediation below)
**Maintained By:** Parker Fellows

## Summary

- **Total Debt Items:** 29 (24 resolved, 5 partially open)
- **Active — Critical:** 0  ·  **High:** 0
- **Remaining:** 5 partially-resolved items with small documented remainders, plus 2
  ops follow-ups (run `db:push` for the DEBT-010 indexes; run the DEBT-020 audit script
  against prod)
- **Suite:** 476/476 passing (was 466); every batch gated on `tsc --noEmit` + vitest

**How this register was produced:** initial automated scan (197 files, ~18k LOC) plus four
manual review passes on 2026-07-02; all Critical/High findings verified against source.
**2026-07-06 re-scan:** automated scan (211 files, ~19k LOC), per-item verification of all
13 open items at HEAD, a manual debt review of the ~5.9k lines landed since (PRs #25/#26,
rebrand, FDD fix), and cross-referencing the 2026-07-02 pre-launch audit
(`audit-report.md`, production-reproduced findings). Suite status: **466/466 passing**.

---

## Remediation — 2026-07-06 (this session)

All 22 open items were worked on branch `fix/tech-debt-2026-07`, committed in batches,
each gated on `tsc --noEmit` + the vitest suite (now **476 passing**, up from 466).

**Resolved (code complete):**
- DEBT-008 — `next` 15.5.14 → 15.5.20; the auth-bypass CVEs + resend/svix/uuid high chain cleared.
- DEBT-009 — orphaned, unauthenticated `/api/kpi/[locationId]` route deleted.
- DEBT-011 — `React.cache()` on getListingById; recordListingView deferred via `after()`.
- DEBT-012 — `buildMetricFromTrend` helper; 5 copy-pasted trend envelopes removed.
- DEBT-013 — shared `toListingFormData` mapper for the seller + admin edit pages.
- DEBT-015 — alert `toRow`/`updateAlert` now driven by one `ALERT_FIELDS` descriptor.
- DEBT-016 — geocoder dynamic-imported off the initial browse chunk; Leaflet CSS self-hosted (no unpkg).
- DEBT-018 — favorites fetches parallelized; created-at ordering restored.
- DEBT-021 — centralized `requireSession/requireAdmin/requireSellerAccess` applied across routes + mutating actions.
- DEBT-022 — disclaimer acknowledgment enforced server-side on the listing-create path.
- DEBT-023 — MapView listing-popup fields escaped (stored-XSS closed).
- DEBT-024 — getUnlistedHsLocations projects only non-PII columns (no more `SELECT *`).
- DEBT-025 — app-wide security headers (CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer/Permissions-Policy).
- DEBT-026 — `onRequestError` instrumentation hook (structured error logging for Vercel observability).
- DEBT-027 — listing writes made atomic via `db.batch` (neon-http has no interactive transactions).

**Resolved in code — one ops step remains:**
- DEBT-010 — 5 indexes added to the Drizzle schema; run `db:push` to apply to prod.
- DEBT-020 — read-only `scripts/audit-cents-corruption.ts` written; run it against prod and repair any flagged rows.

**Partially resolved (documented remainder):**
- DEBT-014 — map-ready guard deduped (`runWhenMapReady`); deeper marker-builder refactor deferred (untested imperative component, needs browser verification).
- DEBT-017 — token TTL cut 7d → 72h; true single-use still needs a nonce store (schema change).
- DEBT-019 — homepage debug comment, MONTH_ABBR, and layout shell deduped; the `proxy.ts` `any` is kept as an intentional NextAuth-middleware bridge (won't-fix).
- DEBT-028 — best-effort in-process rate limiter on the geocode proxy + contact form; a durable/distributed limit needs Upstash/Vercel KV or BotID.
- DEBT-029 — FDD version single-sourced + shared `pointInScope`; the getUnlistedHsLocations query-level test is deferred (pure filters already covered; a db-chain mock would be brittle).

**Subagent security note:** during this work several delegated subagents surfaced
prompt-injection payloads (fake "system"/"trusted background agent" instructions) that
do NOT originate in the repo source. They were ignored, and every shipped change was
independently verified with `tsc` + the test suite.

---

## Active Debt Items

### DEBT-008: Vulnerable production dependencies — `next` 15.5.14 auth-bypass CVEs live in prod

**Category:** Dependency / Security
**Severity:** **Critical** (escalated 2026-07-06 from Medium)
**Created:** 2026-07-02

**Location:**
- File(s): `package.json`, `package-lock.json`

**Description:**
`npm audit --omit=dev`: 0 critical, 3 high, 5 moderate. Top: `next` (DoS via Server
Components), `undici` (header injection), `drizzle-orm` (SQLi via dynamic identifiers —
**not exploitable here**: no user-controlled identifiers reach `sql`, verified), plus
moderate `postcss`, `protocol-buffers-schema`, `resend`, `svix`, `uuid`. Separately, the
scanner flagged `eslint-config-next` pinned exactly (low).

**Proposed Solution (ESCALATED — see 2026-07-06 update below):** bump `next` to >=15.5.18 first;
run the suite + a build after the Next bump. Then `npm audit fix` for the resend/svix/uuid chain.

**Update (2026-07-06) — ESCALATED Medium -> Critical:** installed & locked `next@15.5.14`
unchanged (verified `node_modules/next/package.json` + `package-lock.json`; none of the 4
commits since bumped it). The 2026-07-02 pre-launch audit **reproduced an auth bypass
against production, unauthenticated** via three CVEs (GHSA-267c-6grr-h53f /
GHSA-26hh-7cqf-hhc6 segment-prefetch middleware bypass; GHSA-492v-c6pp-mqqv dynamic-route
param-injection bypass), all fixed >=15.5.16: `GET /admin/queue` with `RSC:1` +
`Next-Router-Prefetch:1` returned 200 (gate bypassed; a plain request correctly 307s to
`/login`); `GET /api/kpi/<id>` returned 204 unauth. This is the audit's #1 Blocker. A
live, credential-free production auth bypass is a ship-blocker, not a "this month"
dependency chore — it is now the single highest-priority item in this register. Fix: bump
`next` to >=15.5.18 and redeploy; add handler-level session checks as defense-in-depth
(DEBT-021); `next build` after the bump (modified Next — read `node_modules/next/dist/docs/`
first; stop the dev server before building on this Windows machine).

**Effort Estimate:** 2-4 hours (bump + verify); DEBT-021 handler checks are separate
**Status:** Open -- **BLOCKER**
**Target Resolution:** Immediately, before any launch

---

### DEBT-009: `/api/kpi/[locationId]` exposes financial KPIs without ownership gate

**Category:** Security
**Severity:** High (escalated 2026-07-06 from Medium)
**Created:** 2026-07-02

**Location:**
- File(s): `src/app/api/kpi/[locationId]/route.ts:3-21`, `src/lib/kpi/fetch.ts:42`

**Description:**
Route has only middleware session auth — no per-listing ownership check and no
`canFetchLiveData` gate the server-component path enforces. Any authenticated user
(including allowlisted external buyers) could enumerate location IDs. Mitigations: serves
mock data unless `HS_INTERNAL_API_URL`/`_TOKEN` are set, and the current UI doesn't use
the route (server components call the fetch layer directly).

**Proposed Solution:** Delete the unused route (preferred), or add authorization.

**Update (2026-07-06):** still open and unchanged -- `route.ts` GET has no `auth()`/session/
ownership check (verified), and the route remains **orphaned** (grep: zero callers; the UI
gets KPI data server-side via `src/lib/kpi/fetch.ts`). The pre-launch audit classified the
missing object-level authZ here as **Blocker #2** (IDOR): combined with the DEBT-008
middleware bypass it is reachable unauthenticated. Escalated to High because it is a
zero-benefit attack surface. Preferred fix remains: **delete the route** (trivial), which
also removes it from DEBT-021's per-handler scope.

**Effort Estimate:** &lt;1 hour
**Status:** Open
**Target Resolution:** This sprint (delete it)

---

### DEBT-010: Missing DB indexes on browse/detail hot paths

**Category:** Performance
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- File(s): `src/db/schema/listings.ts:15-116`, `src/db/schema/favorites.ts:15`; queried from `src/lib/listings-query.ts:84,109,156-163,234`, `src/lib/listing-detail.ts:75-78`

**Description:**
Postgres doesn't auto-index FKs. Missing: `listing_locations(listing_id, display_order)`
and `listing_photos(listing_id, display_order)` (joined on every browse row);
`listings(status, created_at desc)` (browse filter + keyset pagination);
`listings(seller_id)` (seller/admin/analytics); `favorites(listing_id)` (detail-page
count currently seq-scans — the existing unique index leads with `user_id`). Impact
grows with data; fine today at current row counts.

**Proposed Solution:** One Drizzle migration adding the five indexes. Note: DB is
push-managed (drizzle-kit push) — follow the established migration/push workflow.

**Effort Estimate:** 2-3 hours
**Status:** Open
**Target Resolution:** This quarter (before data grows)

---

### DEBT-011: Listing detail page does redundant + blocking work

**Category:** Performance
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- File(s): `src/app/listings/[id]/page.tsx:25,45,50`; `src/lib/listing-detail.ts:62-78`; `src/lib/analytics/views.ts:15-46`

**Description:**
(a) `getListingById` is called twice per request (generateMetadata + page body), 2 DB
roundtrips each, with no `React.cache()` wrapper. (b) `recordListingView` is awaited
before render and internally does `auth()` + select + insert + conditional update, all
sequential — 3-4 blocking roundtrips of pure analytics on the hottest page.

**Proposed Solution:** Wrap `getListingById` in `React.cache()`; move `recordListingView`
to `after()` (or into the existing `Promise.all`, passing the session in).

**Effort Estimate:** 1-2 hours
**Status:** Open
**Target Resolution:** This sprint (quick win)

---

### DEBT-012: KPI metric-shaping logic duplicated 5×

**Category:** Code Quality
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- File(s): `src/lib/kpi/fetch.ts:96-99,123-126,176-185,188-200`, `src/lib/kpi/bundle.ts:41-43`

**Description:**
The `last/prior/momChange` trend computation + `{updatedAt, source:"bigquery"}` envelope
is copy-pasted across single-location membership, single-location revenue, and both
bundle paths. A change to MoM math means five edits.

**Proposed Solution:** One `buildMetricFromTrend(trend, lastOverride?)` helper.

**Effort Estimate:** 2-3 hours
**Status:** Open
**Target Resolution:** This quarter

---

### DEBT-013: Seller vs admin edit pages near-identical

**Category:** Code Quality
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- File(s): `src/app/seller/listings/[id]/edit/page.tsx`, `src/app/admin/listings/[id]/edit/page.tsx`

**Description:**
~85 lines each, same query and DB→form transform (identical `/100` conversions),
differing only in guard/heading.

**Proposed Solution:** Extract shared `toListingFormData(listing)` mapper.

**Effort Estimate:** 2 hours (reduced)
**Status:** Open
**Target Resolution:** This quarter

**Notes:**
- 2026-07-02: the `|| undefined` zero-drop bug on the admin page (dropping legitimate
  `squareFootage: 0` / `ttmRevenue: 0`) was fixed as part of the DEBT-003 batch
  (`?? undefined`). Remaining scope is the page dedup only.

---

### DEBT-014: `MapView.tsx` imperative-effect complexity

**Category:** Code Quality
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- File(s): `src/components/browse/MapView.tsx` (517 lines; marker effects `:219-309`, `:431-491`)

**Description:**
8 `useEffect` / 8 `useRef`; marker effects interleave DOM construction, inline-HTML
popups, and event wiring. The `mapReady ? apply() : m.once('load', apply)` guard is
copy-pasted in 5 effects; circle-bbox math duplicated. (Note: FilterBar/BrowsePage were
flagged by line count but are long-flat, not complex — MapView is the one genuine
hotspot. Its `formatPrice` duplication was resolved by DEBT-004's shared money utils.)

**Proposed Solution:** `useMapReady` helper, extract marker-builder functions, share geo utils.

**Effort Estimate:** 1 day
**Status:** Open
**Target Resolution:** This quarter / opportunistic with next map feature

---

### DEBT-015: `updateAlert`/`toRow` re-enumerate the same 16 fields

**Category:** Code Quality
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- File(s): `src/lib/alert-actions.ts:50-69` (`toRow`), `:121-138` (`updateAlert` patch)

**Description:**
The scanner's "complexity 64/33" is really two long flat lists of the same 16 fields.
Risk is drift when a field is added (same failure mode as the cents bug), not cognitive
complexity.

**Proposed Solution:** Drive both from one field-descriptor list.

**Effort Estimate:** 2 hours
**Status:** Open
**Target Resolution:** This quarter

---

### DEBT-016: Browse bundle ships geocoder statically + two map stacks

**Category:** Performance
**Severity:** Low
**Created:** 2026-07-02

**Location:**
- File(s): `src/components/browse/BrowsePage.tsx:8`, `src/components/browse/LocationSearch.tsx:3-5`, `src/components/listings/TerritoryPicker.tsx:9-25,56`

**Description:**
`LocationSearch` statically imports `@maptiler/geocoding-control` (+CSS) into the initial
browse chunk even though MapView itself is dynamic. The app also carries two map stacks
(`@maptiler/sdk` and `leaflet`/`react-leaflet`), and TerritoryPicker loads Leaflet CSS
from unpkg (external origin).

**Proposed Solution:** Dynamic-import `LocationSearch`; self-host the Leaflet CSS; longer-term consolidate on one map library.

**Effort Estimate:** Small (imports) / Medium (consolidation)
**Status:** Open
**Target Resolution:** Opportunistic

---

### DEBT-017: One-click `markSold` email tokens replayable for 7 days; geocode proxy unthrottled

**Category:** Security
**Severity:** Low
**Created:** 2026-07-02

**Location:**
- File(s): `src/lib/listings/action-tokens.ts:12-24`, `src/app/api/actions/[token]/route.ts`; `src/app/api/geocode/[...q]/route.ts`

**Description:**
(a) Action-link JWTs are valid 7 days with no single-use enforcement — a forwarded email
lets anyone flip a listing to `sold` (bounded by `canTransition`; no data disclosure).
The token verify/transition gates are now test-covered (DEBT-006), but the replay window
remains. (b) The geocode proxy is auth-gated and SSRF-safe (hardcoded host, allow-listed
params) but has no rate limiting, so an authenticated user can burn MapTiler quota.

**Proposed Solution:** Shorter-lived tokens or first-use nonce; lightweight per-user rate limit on geocode.

**Effort Estimate:** 0.5 day combined
**Status:** Open
**Target Resolution:** This quarter

---

### DEBT-018: Favorites page — sequential fetches and lost sort order

**Category:** Performance / Code Quality
**Severity:** Low
**Created:** 2026-07-02

**Location:**
- File(s): `src/app/account/favorites/page.tsx:18-46,98-99`

**Description:**
`getFavoriteListings` and `getSavedCompetitors` awaited sequentially (trivially
parallelizable); inside, two sequential roundtrips where one join would do; and the
second query discards `createdAt desc`, so favorite cards render in arbitrary order
(latent UX bug).

**Proposed Solution:** `Promise.all` the two groups; preserve favorite ordering (sort by the favorites map).

**Effort Estimate:** 1-2 hours
**Status:** Open
**Target Resolution:** Opportunistic

---

### DEBT-019: Minor hygiene — stale debug comment, `any`-typed proxy, month-table duplication, layout duplication

**Category:** Code Quality
**Severity:** Low
**Created:** 2026-07-02

**Location:**
- File(s): `src/app/page.tsx:4` ("Simplified - no auth check for debugging" — page is static marketing, low risk); `src/proxy.ts:10-12` (double-`any` around NextAuth `auth()`); `MONTH_ABBR` tables ×3 (`bigquery/queries.ts`, `kpi/reviews-display.ts:1`, `kpi/mock-data.ts:9-13`); `src/app/admin/layout.tsx` vs `src/app/seller/layout.tsx` (structurally identical); 27 console statements (mostly legitimate `console.error` in catch blocks — consider a thin logger only if observability needs grow)

**Proposed Solution:** Batch cleanup pass.

**Update (2026-07-06):** partially resolved. The `src/app/page.tsx` "no auth check for
debugging" comment is **gone** (page is now static marketing). `MONTH_ABBR` duplication is
down from 3 copies to **2** (`bigquery/queries.ts`, `kpi/reviews-display.ts`; `mock-data.ts`
no longer defines it). Still open: `src/proxy.ts` double-`any` (lines 10, 12); admin vs
seller `layout.tsx` structural duplication.

**Effort Estimate:** 1-2 hours (reduced)
**Status:** Open (partially resolved)
**Target Resolution:** When convenient

---

### DEBT-020: Data audit for historical cents corruption

**Category:** Data Quality
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- Database: `listings.asking_price`, `listings.ttm_profit`

**Description:**
Follow-up to DEBT-001: while the cents bug was live, any listing whose money fields an
admin edited was stored at 1/100th of its real value. The code path is fixed, but
existing rows may still hold corrupted values.

**Proposed Solution:** Read-only query for implausibly low `asking_price` (e.g.
&lt; $10,000 in cents) with an admin-era `updated_at`; manually confirm and repair.

**Effort Estimate:** 1-2 hours
**Status:** Open
**Target Resolution:** This sprint

---

### DEBT-021: No handler-level auth -- every protected surface trusts middleware alone

**Category:** Security
**Severity:** High
**Created:** 2026-07-06

**Location:**
- File(s): all `src/app/api/**/route.ts` protected routes and `src/app/(admin|seller|account)/**` server actions; enforcement point `src/proxy.ts`

**Description:**
Route handlers and page-level server actions rely on the NextAuth middleware/proxy gate for
authentication rather than re-checking the session themselves. That is a single point of
failure: the DEBT-008 `next` CVEs are exploitable precisely *because* a middleware bypass
means **no** downstream check catches the request (the audit reproduced `/admin/queue` and
`/api/kpi/<id>` unauthenticated). Defense-in-depth is missing. (Layout-level guards exist
for some admin/seller trees, but not at the handler/action level for APIs.)

**Proposed Solution:** Add a `requireSession()` / `requireAdmin()` helper and call it at the
top of every protected route handler and mutating server action, so a middleware bypass
degrades to 401 instead of full data exposure. Pair with the DEBT-008 bump.

**Effort Estimate:** 1-2 days
**Status:** Open
**Target Resolution:** With DEBT-008, before launch

---

### DEBT-022: "Selling Your Franchise" disclaimer gate is client-side only -- never enforced on the write path

**Category:** Security / Compliance / Correctness
**Severity:** High
**Created:** 2026-07-06

**Location:**
- File(s): `src/components/listings/ListingDisclaimerGate.tsx:19-36`, `src/lib/listings/disclaimer-actions.ts`, `src/lib/listings/actions.ts` / `persist.ts`, `src/db/schema/disclaimerAcknowledgments.ts`

**Description:**
PR #26 added a disclaimer gate for legal cover, but the acknowledgment is enforced purely in
React state: `ListingDisclaimerGate` swaps to `<ListingWizard>` after
`acknowledgeSellingDisclaimer()` resolves. The listing-creation server actions never read
`listingDisclaimerAcknowledgments` -- verified: the table is written only by
`disclaimer-actions.ts:23` and read by **nothing**. A seller invoking the create/save-draft
server action directly can create a listing with **no acknowledgment row**, defeating the
gate's legal purpose and leaving the audit log incomplete. The action's own comment concedes
it relies on `sellerAccess` downstream, not the ack.

**Proposed Solution:** In the first-persist create action, require (or upsert) an
acknowledgment row for `session.user.id` at the current `FDD_VERSION` before writing the
listing; add a test that the create path rejects/records when no prior ack exists. Confirm
intended legal weight with the product owner.

**Effort Estimate:** 3-4 hours
**Status:** Open
**Target Resolution:** This sprint (legal exposure)

---

### DEBT-023: MapView listing popup interpolates seller-controlled fields into `setHTML` unescaped (stored-XSS)

**Category:** Security
**Severity:** Medium
**Created:** 2026-07-06

**Location:**
- File(s): `src/components/browse/MapView.tsx:252-262`

**Description:**
The listing marker popup interpolates `listing.city`, `listing.state`, and `listing.type`
(and `primaryPhotoUrl`) straight into `setHTML(...)` with no escaping, while the competitor
popup and the new `hs-location-popup.ts` both route through the shared `escapeHtml` helper.
These are seller-controlled fields, so this is a stored-XSS sink on the public browse map.
The rebrand commit recolored these exact lines and added `escapeHtml` to the codebase but
did not apply it here.

**Proposed Solution:** Wrap `city`/`state`/`type` (and validate/encode `primaryPhotoUrl`)
with `escapeHtml`; add a popup-escaping test mirroring `hs-location-popup.test.ts`.

**Effort Estimate:** 1 hour
**Status:** Open
**Target Resolution:** This sprint

---

### DEBT-024: `getUnlistedHsLocations` does `SELECT *` (owner PII) + two uncached full-table reads on the /browse hot path

**Category:** Performance / Data-safety
**Severity:** Medium
**Created:** 2026-07-06

**Location:**
- File(s): `src/lib/hs-locations-query.ts:43-53,77`

**Description:**
Added in PR #25. `db.select().from(ownerLocations)` pulls **every** column -- including
`ownerName`, `ownerContactEmail`, `ownerContactEmailNormalized` -- into server memory on each
/browse render, then maps down to 6 non-PII fields. Not leaked to the client today, but a
latent PII leak if the mapping ever changes, and wasteful. Also: on the default /browse (no
center+radius) the bounding-box branch is skipped, so it scans all geocoded `owner_locations`
plus all active `listing_locations` every request, with the state filter applied in JS
(`hsLocationInScope`) rather than SQL, and no caching. Fine at current row counts; grows
linearly with the directory. (Verified clean on the prior 24h empty-sentinel cache bug -- this
query uses no `unstable_cache` and returns `[]` on error.)

**Proposed Solution:** Replace `SELECT *` with an explicit non-PII projection; push the
`states` filter into the WHERE clause; consider a short-TTL cache that still throws-to-empty.
Also drop the internal row `id` (UUID) and confirm `blvdLocationName` is public-safe before
shipping either to the client. Add a query-level test (currently only the pure filters are
tested).

**Effort Estimate:** 3-4 hours
**Status:** Open
**Target Resolution:** This quarter (before the directory grows)

---

### DEBT-025: No HTTP security headers (CSP / X-Frame-Options / HSTS)

**Category:** Security
**Severity:** Medium
**Created:** 2026-07-06

**Location:**
- File(s): `next.config.ts` (no `headers()`), `src/proxy.ts`

**Description:**
Pre-launch audit High. `next.config.ts` defines no `headers()` and `proxy.ts` sets no
response security headers, so the app ships with no Content-Security-Policy, X-Frame-Options
(clickjacking), Strict-Transport-Security, X-Content-Type-Options, or Referrer-Policy.
Cookie flags themselves were found correct by the audit.

**Proposed Solution:** Add a `headers()` block (or set them in the proxy) with CSP,
X-Frame-Options: DENY, HSTS, X-Content-Type-Options: nosniff, Referrer-Policy. Tune CSP for
the MapTiler/Leaflet/blob origins already in use.

**Effort Estimate:** 3-4 hours (CSP tuning is the bulk)
**Status:** Open
**Target Resolution:** Before launch

---

### DEBT-026: No error monitoring wired before launch (no Sentry)

**Category:** Infrastructure / Reliability
**Severity:** Medium
**Created:** 2026-07-06

**Location:**
- File(s): `package.json` (no `@sentry/*`), no `instrumentation.ts`

**Description:**
Pre-launch audit High. No error-monitoring/observability integration exists -- production
runtime errors (and the `console.error` calls scattered through the write/cron/email paths)
go nowhere a human will see. Launching without this means silent failures.

**Proposed Solution:** Wire Sentry (or Vercel's error monitoring) via `instrumentation.ts`
before launch; route the existing `console.error` sites through it.

**Effort Estimate:** 2-3 hours
**Status:** Open
**Target Resolution:** Before launch

---

### DEBT-027: Multi-step writes are non-atomic -- zero `db.transaction` in the codebase

**Category:** Data-safety
**Severity:** Medium
**Created:** 2026-07-06

**Location:**
- File(s): `src/lib/listings/persist.ts` (listing + `listing_locations` + `listing_photos`), `src/lib/listings/action-tokens.ts` (`executeAction` status transition), admin/seller listing update actions

**Description:**
Pre-launch audit High; re-confirmed 2026-07-06 (`grep .transaction(` in `src/` returns
nothing). The listing create/update path writes the parent `listings` row and its child
`listing_locations` / `listing_photos` rows as separate statements with no transaction, so a
mid-sequence failure leaves a listing with partial locations/photos. Same pattern in the
token-driven status transitions.

**Proposed Solution:** Wrap the persist and status-transition sequences in `db.transaction`
(Drizzle/Neon supports it); add a test that a forced mid-sequence failure rolls back.

**Effort Estimate:** 0.5-1 day
**Status:** Open
**Target Resolution:** This quarter

---

### DEBT-028: No rate limiting on expensive/public endpoints

**Category:** Security / Abuse
**Severity:** Low
**Created:** 2026-07-06

**Location:**
- File(s): `src/app/api/geocode/[...q]/route.ts`, `src/app/api/kpi/[locationId]/route.ts`, contact-form and cron surfaces

**Description:**
Pre-launch audit Medium; re-confirmed 2026-07-06 (no `ratelimit`/`limiter`/`upstash` in
`src/`). The geocode proxy is auth-gated and SSRF-safe but unthrottled, so an authenticated
user can burn the paid MapTiler quota (this is the same concern as DEBT-017(b); consolidate).
No abuse protection on the other public/expensive endpoints either.

**Proposed Solution:** Add a lightweight per-user/IP rate limiter (e.g. Upstash) on the
geocode proxy and other expensive endpoints. Track together with DEBT-017.

**Effort Estimate:** 0.5 day
**Status:** Open
**Target Resolution:** This quarter

---

### DEBT-029: New-code hygiene from the 2026-07-06 re-scan (FDD drift, scope-predicate duplication, missing query test)

**Category:** Code Quality
**Severity:** Low
**Created:** 2026-07-06

**Location:**
- File(s): `src/lib/listings/fdd.ts:6` vs `src/components/listings/SellingDisclaimer.tsx:56,69-75` and the disclaimer-actions test (hardcodes `"2026"`); `src/lib/hs-locations-filter.ts:70-85` vs `src/lib/competitor-filter.ts:22-32`; `src/lib/hs-locations-query.ts` (untested)

**Description:**
Three small items from the new code: (a) **FDD version drift** -- `FDD_VERSION = "2026"` is an
independent source of truth from the hardcoded "2026 FDD" strings and the "$30,000 flat or
10%" broker-fee copy in `SellingDisclaimer.tsx`, and the test hardcodes `"2026"`; bumping the
constant records a new audit version while the displayed copy silently stays old (and a
"figures not stated" line coexists with a stated fee). (b) **Scope-predicate duplication** --
`hsLocationInScope` is a near-verbatim copy of `competitorInScope` (differs only in null-state
handling); geo primitives are correctly shared, only the predicate is duplicated. (c)
`getUnlistedHsLocations` (query + dedupe loop + listed-name exclusion join) has **no test**;
only the pure filter helpers are covered.

**Proposed Solution:** Derive the displayed year/terms from `FDD_VERSION` (or co-locate a
linking comment) and reconcile the figures claim; extract one generic `inScope(point, scope)`
predicate; add a query-level test for `getUnlistedHsLocations`.

**Effort Estimate:** 3-4 hours
**Status:** Open
**Target Resolution:** Opportunistic

---

### DEBT-030: Legacy `users.owner_identifier` / `users.owner_link_source` columns retained but unread

**Category:** Code Quality / Data-safety
**Severity:** Low
**Created:** 2026-07-27

**Location:**
- File(s): `src/db/schema/auth.ts` (`owner_identifier`, `owner_link_source` columns)

**Description:**
The `feat/multi-owner-links` branch replaces the scalar `users.owner_identifier` /
`users.owner_link_source` pair with the `user_owner_links` join table (one user can now hold
several owner profiles). The two legacy columns are deliberately left in place rather than
dropped in the same PR: `scripts/backfill-user-owner-links.ts` reads them once to seed
`user_owner_links`, and keeping them around is a cheap rollback path if the new table needs to
be re-derived. No code reads them once the backfill has run.

**Proposed Solution:** Drop `users.owner_identifier` and `users.owner_link_source` in a
follow-up migration. This is Task 13 of
`docs/superpowers/plans/2026-07-27-multi-owner-links.md`, deliberately deferred to a separate
PR. **Precondition:** PR 1 (this branch) verified in production.

**Effort Estimate:** &lt;1 hour (one migration, no code changes expected)
**Status:** Open
**Target Resolution:** Separate follow-up PR, after PR 1 is verified in production

---

## Resolved Debt Items

### DEBT-001: Admin listing edits corrupted money fields (dollars stored into cents columns) — Critical

**Resolved Date:** 2026-07-02 (PR #23)
**Resolution:** TDD — failing regression test pinned the bug, then `adminUpdateListing`
converts `* 100` (rounded) with fallback to the existing row. Later hardened by DEBT-003's
shared `buildListingUpdate` so the conversion lives in exactly one place.
**Effort Spent:** ~2 hours
**Lessons Learned:** Dual write paths + scattered inline `/100` formatting let a
100× money bug hide. Normalization must have a single home (see DEBT-003/004).
Historical data audit tracked as DEBT-020.

### DEBT-002: `saveDraft` update path had no ownership check (cross-tenant IDOR) — Critical

**Resolved Date:** 2026-07-02 (PR #23)
**Resolution:** TDD — ownership guard (`sellerId === user.id || admin`) added to the
update branch, matching `updateListing`/`submitListing`; 4 tests pin rejection and the
allowed owner/admin paths (`src/__tests__/listings/write-path-guards.test.ts`).
**Effort Spent:** ~2 hours
**Lessons Learned:** Guards added to wrapper functions must be backfilled to the
underlying action when it is independently exposed (here via `/api/listings/draft`).

### DEBT-003: Dual write paths for listing updates — High

**Resolved Date:** 2026-07-02 (DEBT-003–007 batch PR)
**Resolution:** New `src/lib/listings/build-update.ts` (pure, db-free
`buildListingUpdate(data, existing?)` — single home for dollars→cents + asset
normalization) and `src/lib/listings/persist.ts` (shared `insertLocations`/
`insertPhotos`/`syncListingLocations`/`syncListingPhotos`). Both `saveDraft` and
`adminUpdateListing` consume them. Admin edits gained **full parity**: locations +
photos now persist (previously silently dropped). Per-path title semantics preserved.
**Effort Spent:** ~1 day (agent-implemented, reviewed)
**Lessons Learned:** Admin-added locations derive their BQ mapping from the *admin's*
owner directory, so they land as `unconfirmed` and queue for /admin/data review — safe,
but a mild workflow quirk to remember.

### DEBT-004: No shared cents↔dollars / currency-formatting utility — High

**Resolved Date:** 2026-07-02 (batch PR)
**Resolution:** `src/lib/money.ts` (`dollarsToCents`, `centsToDollars`, `formatUsdCents`,
`formatUsdCentsCompact`) + 12 unit tests; all ~12 duplicated call sites replaced with
rendered output preserved exactly (browse `ListingCard`'s hybrid format — abbreviated
millions, full thousands — kept intentionally, flagged in a comment).
**Effort Spent:** ~0.5 day
**Lessons Learned:** —

### DEBT-005: BigQuery empty/error results cached for 24h with no purge path — High

**Resolved Date:** 2026-07-02 (batch PR)
**Resolution:** Cached fetchers now **throw** inside `unstable_cache` when `runQuery`
returns `null` (verified against Next 15.5.14 source: thrown callbacks are never cache-
written); public wrappers catch and return the pre-existing failure sentinels, so the
caller contract is unchanged. Legit-empty successful results still cache.
`fetchLocationKpi`: mock branch moved outside the cache; live failures no longer cached.
+9 tests pin failure-then-recovery.
**Effort Spent:** ~0.5 day
**Lessons Learned:** Never coerce a failure sentinel to an empty result *inside* a cache
wrapper. (No admin purge endpoint added — descoped; failures simply no longer cache.)

### DEBT-006: Core write paths and auth logic untested; tautological test files — High

**Resolved Date:** 2026-07-02 (batch PR)
**Resolution:** `auth.test.ts` (15 tests) and `admin.test.ts` (11 tests) rewritten to
exercise the real NextAuth callbacks and last-admin guards. 6 new files (+84 tests):
action tokens (tamper/expiry/forgery/transition gate), all three cron routes (401 gates,
record-only-after-successful-send), upload route gates, and a 48-case table test of the
middleware `authorized`/`PUBLIC_PATHS` callback — which **cleared** the suspected prefix
over-match (exact-or-slash-boundary matching, test-verified). Suite grew 306 → 436.
**Effort Spent:** ~1 day (agent-implemented, reviewed)
**Lessons Learned:** Tests that re-implement logic inline pass forever and protect
nothing; every test must import the production function.

### DEBT-007: No CI and no coverage tooling — High

**Resolved Date:** 2026-07-02 (batch PR)
**Resolution:** `.github/workflows/ci.yml` — `tsc --noEmit` + `npm test` (vitest) on
every PR and push to main, node 24 (matches `engines`). Lint intentionally excluded
(broken pre-existing). Coverage thresholds deferred until a baseline is measured.
**Effort Spent:** ~30 min
**Lessons Learned:** —

---

## Won't Fix Items

### Scanner "magic numbers" (240 flagged)

**Decision Date:** 2026-07-02
**Reason:** ~All are Tailwind utility classes (`bg-gray-900`, `duration-200`) misread as numeric literals. Not debt.
**Decision Maker:** Audit review

### Full-table competitor-closure fetch (`src/lib/competitor-query.ts:59`)

**Decision Date:** 2026-07-02
**Reason:** Documented as intentional — closure dataset is small; scoped path uses the geo index correctly. **Watch item:** revisit (projection + limit) if the scraper dataset grows.
**Decision Maker:** Audit review

---

## Debt Trends

### By Category (active)
- Security: 8 items (DEBT-008, 009, 017, 021, 022, 023, 025, 028)
- Code Quality: 6 items (DEBT-012, 013, 014, 015, 019 [partial], 029)
- Performance: 4 items (DEBT-010, 011, 016, 018)
- Data-safety: 2 items (DEBT-024, 027)
- Data Quality: 1 item (DEBT-020)
- Infrastructure: 1 item (DEBT-026)
- (DEBT-008 also counts as Dependency; DEBT-024 also perf)

### By Severity
- Active: 1 Critical (DEBT-008) · 3 High (DEBT-009, 021, 022) · 12 Medium · 6 Low
- Note: DEBT-008 escalated Medium->Critical and DEBT-009 Medium->High on 2026-07-06 after the
  pre-launch audit reproduced a live production auth bypass.
- Resolved to date: 2 Critical · 5 High

### Aging
- 2026-07-02 cohort: 13 items (12 still active; DEBT-019 partially resolved)
- 2026-07-06 cohort: 9 new items (DEBT-021-029), from the re-scan + pre-launch audit reconciliation

---

## Verified-Clean Areas (from the 2026-07-02 audit)

Worth recording so future audits don't re-litigate:
- **AuthZ:** all admin/owner-directory/alert/favorites/saved-competitor actions properly session- and ownership-gated; cron routes check `CRON_SECRET`; upload route validates auth + content-type + 10MB; middleware full-gates with layout-level defense-in-depth. (The one gap, DEBT-002, is fixed and test-pinned.)
- **Injection/XSS:** BigQuery SQL is static constants (no user input); all Drizzle `sql` usage parameterized; no `dangerouslySetInnerHTML`; no open redirects.
- **Secrets:** only `.env.example` (placeholders) tracked; `.secrets/`, `.env*`, `*-bq-key.json`, `*.pem` gitignored.
- **Query layer:** `listings-query.ts` (single query, keyset pagination, bbox prefilter, `DISTINCT ON`) and admin analytics (SQL aggregates + `Promise.all`) are exemplary — no N+1 anywhere.
- **Module boundaries:** kpi ↔ bigquery ↔ owner-directory import only public accessors; `db/schema.ts` is a pure barrel; `normalizeName`/`geocodeAddress` properly centralized.
- **Maps:** MapView/DetailMap/TerritoryPicker all correctly lazy-loaded.
- **Dependencies:** no deprecated packages, no duplicate-functionality libs (besides the two map stacks, DEBT-016).
- **Middleware path matching:** `PUBLIC_PATHS` uses exact-or-slash-boundary matching (no `/loginX` over-match) — now pinned by 48 table tests.

---

## Review Schedule

- **Weekly:** Triage new items, update status
- **Monthly:** Review Medium items, plan fixes
- **Quarterly:** Full debt re-scan (automated + manual), trend analysis

## Suggested Attack Order (remaining)

0. **BEFORE LAUNCH (blockers/gates):** DEBT-008 (bump `next` >=15.5.18 + redeploy -- the live
   auth bypass), DEBT-021 (handler-level auth as defense-in-depth), DEBT-009 (delete the
   unauthenticated KPI route), DEBT-022 (enforce the disclaimer ack on the write path),
   DEBT-025 (security headers), DEBT-026 (error monitoring).
1. **This sprint:** DEBT-023 (escape MapView popup -- XSS), DEBT-020 (data audit), DEBT-011
   (detail-page quick wins).
2. **This month:** remaining `npm audit fix` chain (part of DEBT-008), DEBT-027 (transactions).
3. **This quarter:** DEBT-010 (index migration), DEBT-024 (browse-query projection/cache),
   DEBT-012, DEBT-013, DEBT-014, DEBT-015, DEBT-017/DEBT-028 (tokens + rate limiting together).
4. **Opportunistic:** DEBT-016, DEBT-018, DEBT-019, DEBT-029.
