# HS-Marketplace — Pre-Launch Audit Report

- **Target:** https://marketplace.hellosugar.salon/
- **Auditor:** pre-launch-audit v0.2 (4 parallel auditors — security on Opus-high, UI/UX + code-quality + brand on Sonnet)
- **Date:** 2026-07-06
- **Session:** Behavioral checks ran with a **valid admin + seller session** (Parker Fellows) and working Playwright/Chromium — so the full authenticated surface was exercised this run, unlike the 2026-07-02 audit (dead cookie, no browser).
- **Verdict:** 🔴 **NO-GO**

---

## Verdict: NO-GO

**2 open Blockers.** Huge progress since 2026-07-02 — the entire security pillar flipped from 4 blockers to zero, and the brand pillar went from 2/11 to 9/14 passing — but two things still hard-block launch: the **core seller flow can't be completed through the UI**, and **production schema drift** persists with no migration record.

### Blocking items (fix these first)

1. **Seller listing wizard is broken — cannot create a listing** *(UI/UX · Blocker · CONFIRMED live)*
   On `/seller/listings/new`, entering a valid Asking Price and clicking **Next** never advances past the Financials step, and shows no error. Root cause: `listingSchema` is a Zod `.and()` intersection of all three steps, so `methods.trigger([...financials fields])` can't field-scope it and re-validates the whole schema — including Step 3's `photos.min(1)`, which is empty at Step 2. Validation silently fails and `setStep(3)` never runs. The one task the seller product exists for is impossible via the UI.
   → Give each wizard step its own `z.object()` (or use `.pick()`/`superRefine` per step) instead of slicing an intersection, and surface any validation error on every step. *(`ListingWizard.tsx:65-76`, `schemas.ts:89-103`)*

2. **Production schema drift — tables and a column rename never migrated** *(Code Quality · Blocker · CONFIRMED)*
   `drizzle/` has 5 clean migrations, but four **live** tables (`owner_locations`, `login_events`, `listing_views`, `competitor_alert_log`) have **no CREATE TABLE anywhere in migration history**, and `0001`'s `boulevard_*` columns were renamed to `bq_location_name`/`data_mapping_status` in the schema with no migration capturing it. `db:push` isn't in the build/CI (confirmed), so these reached prod only via a human running `drizzle-kit push`. The prod schema is unauditable, and the 5 performance indexes (DEBT-010) are in the same boat.
   → `drizzle-kit generate` a reconciliation migration (tables + column rename + the 5 indexes), diff it against the live DB before applying, commit as `0005_*.sql`; ban `db:push` outside local; add a CI drift detector.

---

## Four-Pillar Summary

| Pillar | Pass | Fail | N/A | Open Blockers | Open High |
| :---- | :----: | :----: | :----: | :----: | :----: |
| UI/UX & Functional QA | 4 | 9 | 1 | 1 | 4 |
| Security & Deployment | 14 | 1 | 3 | 0 | 1 |
| Code Quality & Tech Debt | 4 | 12 | 0 | 1 | 3 |
| Brand Conformance | 9 | 5 | 0 | 0 | 2 |
| **Total** | **31** | **27** | **4** | **2** | **10** |

**Gate application:**
1. Zero open Blockers → **FAILED** (2 open).
2. Auto-escalation (auth / authz / secrets / prod-deploy / DB-conn / migrations → Blocker) → applied; only migrations triggered it this run (security had zero fails in those categories).
3. All open High items have a tracked ticket + owner + date → **not met** (10 open High).

---

## Failures by Severity

### 🔴 Blockers (2)
| Pillar | Check |
| :-- | :-- |
| UI/UX | Core flows complete end-to-end — seller listing wizard stuck at Financials |
| Code Quality | Schema changes go through tracked migrations — prod drift, 4 tables + rename unmigrated |

### 🟠 High (10)
| Pillar | Check |
| :-- | :-- |
| UI/UX | No dead interactions — React #418 hydration error on `/admin/listings` (naive date TZ) |
| UI/UX | No race conditions — favorite toggle shows stale state vs. server |
| UI/UX | Navigation never a dead end — home page shows logged-out chrome to signed-in users |
| UI/UX | Intuitive on first contact — compound of the above two |
| Security | Error monitoring wired before launch — no Sentry/APM (logs only) |
| Code Quality | No performance debt — 5 indexes only in TS schema, unverifiable in prod |
| Code Quality | Multi-step writes safe — listing **edit** path is 3 non-atomic writes (create path is fine) |
| Code Quality | Config/env centralized — ~24 raw `process.env` reads bypass `env.ts`; `NEXT_PUBLIC_APP_URL` undeclared |
| Brand | Colors from tokens — many inline `#ED1845` hex literals bypass the palette variables |
| Brand | Contrast limits — 14px/600 white-on-crimson button narrowly fails AA |

### 🟡 Medium (11)
UI/UX: favorites gives no click feedback (missing `revalidatePath`); axe violations on 6/6 pages (contrast, geocoder button-name, nested-interactive ×58, star-rating aria, no `<main>`); offline delete fails silently; naive date formatting. Code Quality: dead code (incl. the public `/preview/kpi` route that says "delete before prod"); duplicated fetch+auth block across 4 listing pages; no Playwright e2e smoke suite; stock create-next-app README; two map stacks shipped. Brand: HeaderNav nav items have no brand focus ring (+ ring uses `-500` not `-600`); token files hand-ported, not vendored/wired to `generate.py`.

### ⚪ Low (4)
Code Quality: eslint config crashes (`ERR_MODULE_NOT_FOUND`), never in CI; `console.log` in the prod upload route; never-wired `email-templates.tsx` LLM scaffold. Brand: stock Next.js favicon instead of the drop mark.

*(Full structured payloads — evidence, `file:line`, proposed fix, reproduce command for each of the 27 failures — are in `audit-report.json`.)*

---

## What changed since 2026-07-02

**Resolved (all 3 security-side blockers + the framework CVE):**
- `next` bumped to **15.5.20** — the RSC/segment-prefetch and `x-middleware-subrequest` auth bypasses were **re-verified closed live** (protected routes return an empty flight payload / 307, not admin data).
- **IDOR fixed** — the unauth `/api/kpi/[locationId]` route was deleted (404), and ownership checks now hold across listing/alert/favorites paths (static trace clean).
- **Production config** — prod serves over HTTPS with a full security-header set (HSTS preload, CSP, X-Frame-Options DENY, nosniff); the debug KPI route is gone.

**Still open from prior:** schema-migration discipline (Blocker #2 above).

**New this run** (only findable with a real session, which 2026-07-02 lacked): the seller-wizard Blocker, the admin hydration error, the favorites feedback/race bug, the logged-out home-page chrome, and silent offline handling.

---

## ⚠️ Read before trusting the columns

- **Lighthouse (UI perf) is N/A** — the audit machine's C: drive hit **0 bytes free** mid-run (`ENOSPC`); no Core Web Vitals captured. Manual crawl showed no obvious jank, but this check is unverified.
- **`gitleaks` / `semgrep` couldn't run** on this Windows host (no npx-resolvable binary). Secrets and injection were covered by a git-tracked scan + live/local **bundle secret scan** (both clean) + manual review — but install native binaries for a proper scan before launch.
- **`knip` crashed** (native oxc-parser buffer error); dead-code findings came from `ts-prune` + hand-verification. Re-run knip in a normal CI runner.
- **Two Security checks N/A for missing inputs:** session-invalidation/logout (no pre/post-logout cookie pair; DB-session design supports it) and service-account least-privilege (needs GCP console). Domain-restricted sign-in **passed** (personal Gmail correctly rejected, user-confirmed + static).
- **Data hygiene:** reproducing the seller Blocker created **~12 `$0` draft test listings** under parker.fellows@hellosugar.salon on the **live prod DB**, and there's no seller-facing delete-draft action to remove them — needs a UI affordance or a DB cleanup pass.

---

## Headline read

The security turnaround is real and verified — the app that was live-exploitable on July 2 now holds up under authenticated probing. What's left blocking launch is one **functional** defect (a form-validation bug that makes the primary seller task impossible) and one **process** defect (prod schema managed by `push`, not migrations). Both are well-scoped: the wizard is a schema-shape fix in one component, and the migration drift is a `generate` + reconcile + guardrail. The 10 High items are mostly a coherent cluster — naive date/TZ handling (hydration + display), the `useOptimistic`-without-revalidation favorites pattern, and env/token centralization — each fixable in a focused pass. Clear those two Blockers and ticket the Highs and this is close.
