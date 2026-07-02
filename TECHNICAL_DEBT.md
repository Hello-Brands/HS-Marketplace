# Technical Debt Register

**Project:** HS-Marketplace
**Last Updated:** 2026-07-02
**Maintained By:** Parker Fellows

## Summary

- **Total Debt Items:** 19
- **Critical:** 2
- **High:** 5
- **Medium:** 7
- **Low:** 5
- **Estimated Total Effort:** ~12-15 days

**How this register was produced:** automated scan (197 files, ~18k LOC, code-smell +
dependency analysis) plus four manual review passes (architecture, tests, security,
performance/data). Test suite status at time of audit: **300/300 passing**. All
Critical/High findings were verified against the source before being recorded.

---

## Active Debt Items

### DEBT-001: Admin listing edits corrupt money fields (dollars stored into cents columns)

**Category:** Code Quality (Correctness)
**Severity:** Critical
**Created:** 2026-07-02

**Location:**
- File(s): `src/lib/admin/actions.ts:192-193` (vs. correct path `src/lib/listings/actions.ts:42-43,99-100`)
- Component/Module: `adminUpdateListing`

**Description:**
`adminUpdateListing` writes `askingPrice: data.askingPrice ?? listing.askingPrice` and
`ttmProfit: data.ttmProfit` with **no `* 100` conversion**, while the seller path
(`saveDraft`) correctly multiplies by 100. The edit form works in dollars (pages seed it
with `listing.askingPrice / 100`). In the same set-block, `inventoryCostEstimate` *is*
converted (`:199-202`), confirming the omission is an oversight. Additionally,
`ttmProfit` has no fallback to the existing value, so partial admin edits can null it.

**Impact:**
- **Business Impact:** An admin edit silently turns a $500,000 listing into $5,000 — financial data corruption visible to buyers.
- **Technical Impact:** Zero test coverage on this path; nothing would catch a regression.
- **Risk:** Silent, hard-to-notice data corruption on every admin edit that touches money fields.

**Root Cause:** Dual write paths (see DEBT-003) — the money-normalization rule lives inline in two places and drifted.

**Proposed Solution:**
1. Add a failing regression test first: call `adminUpdateListing` with `{askingPrice: 50000, ttmProfit: 30000}` and assert the `.set()` payload is in cents.
2. Mirror the seller conversions (`* 100`, `?? listing.ttmProfit` fallback), or better, fix via the shared normalize helper in DEBT-003.
3. Audit existing rows for corrupted values (prices implausibly < $10,000 with recent admin `updatedAt`).

**Effort Estimate:** 2-4 hours (fix + test); + data audit if corrupt rows exist
**Priority Justification:** Active data-corruption bug on a live write path.
**Dependencies:** Related: DEBT-003, DEBT-004
**Status:** Open
**Assignee:** Unassigned
**Target Resolution:** Immediately

---

### DEBT-002: `saveDraft` update path has no ownership check (cross-tenant listing overwrite / IDOR)

**Category:** Security
**Severity:** Critical
**Created:** 2026-07-02

**Location:**
- File(s): `src/lib/listings/actions.ts:25-90` (update branch `:36-56`); exposed via `src/app/api/listings/draft/route.ts:7`
- Component/Module: `saveDraft` server action + draft API route

**Description:**
`saveDraft(data, listingId)` only calls `requireSellerAccess()`. When `listingId` is
supplied it runs `UPDATE listings ... WHERE id = listingId` with no check that the
listing belongs to the caller. Sibling wrappers `updateListing` (`:149`) and
`submitListing` (`:124`) do verify `sellerId === user.id`; `saveDraft` does not, and the
`/api/listings/draft` POST route passes a client-supplied `listingId` straight through.
Verified at source.

**Impact:**
- **Business Impact:** Any seller (all `@hellosugar.salon` users get `sellerAccess` by default, `src/auth.ts:77-83`) can overwrite another seller's listing — price, title, notes — and delete+replace its locations and photos.
- **Technical Impact:** Undermines the otherwise-consistent ownership model in this file.
- **Risk:** Cross-tenant data tampering / destructive overwrite.

**Root Cause:** `saveDraft` predates the guarded wrappers; the guard was added to the wrappers but not backfilled.

**Proposed Solution:** When `listingId` is present, load the row and enforce
`sellerId === user.id || role === 'admin'` before writing (mirror `updateListing`).
Consider making `saveDraft` internal so all writes flow through guarded wrappers. Add a
test asserting the rejection.

**Effort Estimate:** 2-3 hours (guard + tests)
**Priority Justification:** Authorization gap on a mutating endpoint; classic IDOR.
**Dependencies:** Related: DEBT-006 (untested write paths)
**Status:** Open
**Assignee:** Unassigned
**Target Resolution:** Immediately

---

### DEBT-003: Dual write paths for listing updates (`saveDraft` vs `adminUpdateListing`)

**Category:** Architecture
**Severity:** High
**Created:** 2026-07-02

**Location:**
- File(s): `src/lib/listings/actions.ts:36-90`, `src/lib/admin/actions.ts:177-212`

**Description:**
Two independent set-blocks persist the same listing fields with different rules.
`saveDraft` also handles locations + photos (with geo/BQ-mapping preservation);
`adminUpdateListing` updates scalar fields only, silently dropping admin edits to
locations/photos. This structural split is the root cause of DEBT-001, and every new
money/listing field must currently be added in two places (already a known gotcha).

**Impact:**
- **Business Impact:** Admin edits to locations/photos are silently lost; money fields have already drifted (DEBT-001).
- **Technical Impact:** Double maintenance; guaranteed future drift.
- **Risk:** Next new field repeats the cents bug.

**Root Cause:** Admin editing added later as a parallel implementation instead of extending the seller path.

**Proposed Solution:** Extract a shared `buildListingUpdate(data, existing)` that returns
the normalized set-object (single home for dollars→cents); both actions consume it.
Decide explicitly whether admin edits should also update locations/photos.

**Effort Estimate:** 0.5-1 day
**Priority Justification:** Root cause of a Critical; high-churn surface.
**Dependencies:** Blocks durable fix of DEBT-001; Related: DEBT-004
**Status:** Open
**Target Resolution:** This sprint

---

### DEBT-004: No shared cents↔dollars / currency-formatting utility (reinvented ~10×)

**Category:** Code Quality
**Severity:** High
**Created:** 2026-07-02

**Location:**
- File(s): `components/listings/ListingCard.tsx:47-51`, `components/admin/AdminListingCard.tsx:38-42`, `components/admin/ListingsTable.tsx:78-82`, `components/listing-detail/FinancialsGrid.tsx:9-13`, `app/seller/listings/[id]/page.tsx:42-46`, `app/admin/listings/[id]/page.tsx:34-38`, `lib/email.ts:209`, `components/browse/ListingCard.tsx:29-36`, `components/browse/MapView.tsx:29-32`, `app/account/favorites/page.tsx:75-82`, `components/kpi/LocationKpiCards.tsx:16`, `components/kpi/BundleKpiSection.tsx:15`

**Description:**
Cents→display formatting is re-implemented in ~10+ call sites (including `formatDollars`
defined identically twice). There is no shared `formatUsdCents` / `dollarsToCents` /
`centsToDollars`. This scattering is what let DEBT-001 hide.

**Impact:**
- **Technical Impact:** Every money display/store site is a fresh chance to get the ×100 wrong.
- **Risk:** More cents bugs.

**Proposed Solution:** Add `formatUsdCents(cents)` plus `dollarsToCents`/`centsToDollars`
in one util; replace call sites mechanically.

**Effort Estimate:** 0.5 day
**Priority Justification:** Cheap; systemically prevents the Critical class of bug.
**Dependencies:** Related: DEBT-001, DEBT-003
**Status:** Open
**Target Resolution:** This sprint

---

### DEBT-005: BigQuery empty/error results cached for 24h with no purge path

**Category:** Performance / Reliability
**Severity:** High
**Created:** 2026-07-02

**Location:**
- File(s): `src/lib/bigquery/queries.ts:121-128,130-137,147-154,307-316`; `src/lib/bigquery/client.ts:49-59`; same pattern at `src/lib/kpi/fetch.ts:75-79`

**Description:**
Every cached BQ fetcher coerces `runQuery()` failures (`null` on missing creds or query
error) to `[]` **inside** `unstable_cache` with `revalidate: 86400` — so one bad deploy
poisons all KPI/review cards as "not connected" for 24h. No `revalidateTag` call exists
anywhere for the `bq-*` tags, so there is no purge path. This exact failure already
happened in production once (creds misconfig → 24h of empty KPIs). `fetchLocationKpi`
has the same cache-the-failure pattern at lower stakes (5-min window, also caches mock
data under the same key).

**Impact:**
- **Business Impact:** A transient BQ failure blanks financial data for all buyers for a day.
- **Risk:** Known past incident; root cause still in code.

**Root Cause:** Error handling returns sentinel `null` instead of throwing; `unstable_cache` happily caches the coerced empty result.

**Proposed Solution:** Throw inside the cached function (uncaught errors are not cached
by `unstable_cache`) and catch at the caller; or skip caching / short-revalidate empty
results. Add a `revalidateTag` admin escape hatch for `bq-*` tags.

**Effort Estimate:** 0.5 day incl. tests
**Priority Justification:** Recurrence of a real production incident is one misdeploy away.
**Dependencies:** None
**Status:** Open
**Target Resolution:** This sprint

---

### DEBT-006: Core write paths and auth logic untested; two test files are tautological

**Category:** Test
**Severity:** High
**Created:** 2026-07-02

**Location:**
- File(s): `src/__tests__/auth.test.ts`, `src/__tests__/admin.test.ts` (tautological); untested: `src/lib/listings/actions.ts`, `src/lib/admin/actions.ts`, `src/lib/listings/action-tokens.ts`, `src/app/api/upload/route.ts`, `src/app/api/cron/*`, `middleware.ts`/`src/auth.config.ts:31-38`

**Description:**
The suite (45 files, 300 tests, all passing) covers pure helpers well, but the
stateful/critical layer is dark. `auth.test.ts` and `admin.test.ts` re-implement the
logic inline and never import the production code — they pass even if the real guards
are deleted. Untested: money-cents conversion on both write paths (DEBT-001 would have
been caught), the `insertLocations` security invariant (server-side BQ mapping),
JWT action tokens (auth-bypass surface), all three cron routes' `CRON_SECRET` 401 gate,
the upload route's auth/type/size gate, and the middleware `PUBLIC_PATHS` logic.

**Impact:**
- **Technical Impact:** Green suite gives false confidence on exactly the paths where bugs are most expensive.
- **Risk:** Regressions in auth or money handling ship silently.

**Root Cause:** Testing effort focused on easily-testable pure functions; hand-rolled Drizzle mock chains make action tests expensive to write (see Notes).

**Proposed Solution (ordered):**
1. Regression test pinning DEBT-001, then fix.
2. Replace tautological `auth.test.ts`/`admin.test.ts` with tests importing the real functions.
3. Add tests: `saveDraft` ownership rejection (DEBT-002), action-token tamper/expiry/transition-gate, cron 401s, upload auth gate, middleware path table-test.
4. Build a small shared db-mock helper first — existing hand-rolled `.select().from().where()` chain mocks are order-coupled and fragile; a harness pays back across all of the above.

**Effort Estimate:** 2-3 days total
**Priority Justification:** Directly guards the two Critical items.
**Dependencies:** Related: DEBT-001, DEBT-002, DEBT-007
**Status:** Open
**Target Resolution:** This sprint / next

---

### DEBT-007: No CI and no coverage tooling

**Category:** Infrastructure
**Severity:** High
**Created:** 2026-07-02

**Location:**
- File(s): `.github/` (does not exist); `vitest.config.mts` (no coverage config)

**Description:**
No CI of any kind — tests only run when someone runs them locally. No
`@vitest/coverage-*`, no thresholds. Nothing stops a PR that breaks the suite.

**Impact:**
- **Risk:** All test debt above can widen unnoticed; a red suite can merge.

**Proposed Solution:** Add `.github/workflows/ci.yml` running `npx vitest run` + `tsc --noEmit`
on PRs. Add coverage reporting (thresholds optional initially).

**Effort Estimate:** 2-3 hours
**Priority Justification:** Cheapest high-leverage item in the register.
**Dependencies:** Amplifies value of DEBT-006
**Status:** Open
**Target Resolution:** Immediately (quick win)

---

### DEBT-008: Vulnerable production dependencies (npm audit: 3 high / 5 moderate)

**Category:** Dependency / Security
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- File(s): `package.json`, `package-lock.json`

**Description:**
`npm audit --omit=dev`: 0 critical, 3 high, 5 moderate. Top: `next` (DoS via Server
Components), `undici` (header injection), `drizzle-orm` (SQLi via dynamic identifiers —
**not exploitable here**: no user-controlled identifiers reach `sql`, verified), plus
moderate `postcss`, `protocol-buffers-schema`, `resend`, `svix`, `uuid`. Separately, the
scanner flagged `eslint-config-next` pinned exactly (low).

**Proposed Solution:** `npm audit fix`; bump `next` and `undici` to patched versions;
run the suite + a build after the Next bump.

**Effort Estimate:** 2-4 hours
**Status:** Open
**Target Resolution:** This month

---

### DEBT-009: `/api/kpi/[locationId]` exposes financial KPIs without ownership gate

**Category:** Security
**Severity:** Medium
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

**Effort Estimate:** &lt;1 hour
**Status:** Open
**Target Resolution:** This sprint (trivial)

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

### DEBT-013: Seller vs admin edit pages near-identical, with a `|| undefined` zero-drop bug

**Category:** Code Quality
**Severity:** Medium
**Created:** 2026-07-02

**Location:**
- File(s): `src/app/seller/listings/[id]/edit/page.tsx`, `src/app/admin/listings/[id]/edit/page.tsx`

**Description:**
~85 lines each, same query and DB→form transform (identical `/100` conversions),
differing only in guard/heading — except the admin page uses `|| undefined`, which drops
legitimate `0` values (e.g. `squareFootage: 0`, `ttmRevenue: 0`).

**Proposed Solution:** Extract shared `toListingFormData(listing)` mapper; standardize on `?? undefined`.

**Effort Estimate:** 3 hours
**Status:** Open
**Target Resolution:** This quarter

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
copy-pasted in 5 effects; circle-bbox math duplicated; `formatPrice` duplicates
FilterBar's `fmtShortPrice`. (Note: FilterBar/BrowsePage were flagged by line count but
are long-flat, not complex — MapView is the one genuine hotspot.)

**Proposed Solution:** `useMapReady` helper, extract marker-builder functions, share geo/format utils.

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
(b) The geocode proxy is auth-gated and SSRF-safe (hardcoded host, allow-listed params)
but has no rate limiting, so an authenticated user can burn MapTiler quota.

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
- File(s): `src/app/page.tsx:4` ("Simplified - no auth check for debugging" — page is static marketing, low risk); `src/proxy.ts:10-12` (double-`any` around NextAuth `auth()`); `MONTH_ABBR` tables ×3 (`bigquery/queries.ts:57`, `kpi/reviews-display.ts:1`, `kpi/mock-data.ts:9-13`); `src/app/admin/layout.tsx` vs `src/app/seller/layout.tsx` (structurally identical); 27 console statements (mostly legitimate `console.error` in catch blocks — consider a thin logger only if observability needs grow)

**Proposed Solution:** Batch cleanup pass.

**Effort Estimate:** 2-3 hours
**Status:** Open
**Target Resolution:** When convenient

---

## Resolved Debt Items

_None yet — register created 2026-07-02._

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

### By Category
- Code Quality: 7 items
- Architecture: 1 item
- Test: 1 item (spanning many gaps)
- Dependency: 1 item
- Performance: 4 items
- Security: 3 items
- Infrastructure: 1 item
- Design: 0 items
- Documentation: 0 items

### By Severity
- Critical: 2 · High: 5 · Medium: 7 · Low: 5

### Aging
- < 1 month: 19 items (initial register)

---

## Verified-Clean Areas (from this audit)

Worth recording so future audits don't re-litigate:
- **AuthZ:** all admin/owner-directory/alert/favorites/saved-competitor actions properly session- and ownership-gated; cron routes check `CRON_SECRET`; upload route validates auth + content-type + 10MB; middleware full-gates with layout-level defense-in-depth. (Sole gap: DEBT-002.)
- **Injection/XSS:** BigQuery SQL is static constants (no user input); all Drizzle `sql` usage parameterized; no `dangerouslySetInnerHTML`; no open redirects.
- **Secrets:** only `.env.example` (placeholders) tracked; `.secrets/`, `.env*`, `*-bq-key.json`, `*.pem` gitignored.
- **Query layer:** `listings-query.ts` (single query, keyset pagination, bbox prefilter, `DISTINCT ON`) and admin analytics (SQL aggregates + `Promise.all`) are exemplary — no N+1 anywhere.
- **Module boundaries:** kpi ↔ bigquery ↔ owner-directory import only public accessors; `db/schema.ts` is a pure barrel; `normalizeName`/`geocodeAddress` properly centralized.
- **Maps:** MapView/DetailMap/TerritoryPicker all correctly lazy-loaded.
- **Dependencies:** no deprecated packages, no duplicate-functionality libs (besides the two map stacks, DEBT-016).

---

## Review Schedule

- **Weekly:** Triage new items, update status
- **Monthly:** Review Critical/High items, plan fixes
- **Quarterly:** Full debt re-scan (automated + manual), trend analysis

## Suggested Attack Order

1. **Today:** DEBT-001 (cents bug — test then fix), DEBT-002 (IDOR guard), DEBT-007 (CI in one sitting)
2. **This sprint:** DEBT-003 + DEBT-004 (shared write/format helpers — durable fix), DEBT-005 (BQ cache), DEBT-006 items 1-3, DEBT-009 (delete route), DEBT-011 (quick perf wins)
3. **This quarter:** DEBT-008, DEBT-010, DEBT-012 through DEBT-015, DEBT-017
4. **Opportunistic:** DEBT-016, DEBT-018, DEBT-019
