# Technical Debt Register

**Project:** HS-Marketplace
**Last Updated:** 2026-07-02 (DEBT-001–007 resolved)
**Maintained By:** Parker Fellows

## Summary

- **Total Debt Items:** 20 (13 active, 7 resolved)
- **Active — Critical:** 0
- **Active — High:** 0
- **Active — Medium:** 8
- **Active — Low:** 5
- **Estimated Remaining Effort:** ~5-7 days

**How this register was produced:** automated scan (197 files, ~18k LOC, code-smell +
dependency analysis) plus four manual review passes (architecture, tests, security,
performance/data) on 2026-07-02. All Critical/High findings were verified against the
source before being recorded. Suite status after the resolution batch: **436/436 passing**.

---

## Active Debt Items

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

**Effort Estimate:** 2-3 hours
**Status:** Open
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
- Code Quality: 5 items
- Performance: 3 items
- Security: 2 items
- Dependency: 1 item
- Data Quality: 1 item

### By Severity
- Active: 0 Critical · 0 High · 8 Medium · 5 Low
- Resolved to date: 2 Critical · 5 High

### Aging
- < 1 month: 13 active items (initial register 2026-07-02)

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

1. **This sprint:** DEBT-020 (data audit — quick, follows directly from DEBT-001), DEBT-009 (delete unused KPI route), DEBT-011 (detail-page quick wins)
2. **This month:** DEBT-008 (dependency bumps)
3. **This quarter:** DEBT-010 (index migration), DEBT-012, DEBT-013, DEBT-014, DEBT-015, DEBT-017
4. **Opportunistic:** DEBT-016, DEBT-018, DEBT-019
