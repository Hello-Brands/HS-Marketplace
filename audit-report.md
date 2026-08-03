# HS-Marketplace — Pre-Launch Audit Report

- **Target:** https://marketplace.hellosugar.salon/ (live production)
- **Commit:** `56766d5` — the live production deployment matches HEAD exactly (verified via Vercel)
- **Rubric:** hs-pre-launch-audit v0.2 (62 checks across four pillars)
- **Auditor:** pre-launch-audit orchestrator (Fable 5) + four pillar auditors
- **Date:** 2026-08-03
- **Supersedes:** the 2026-07-06 audit report in this repo
- **Verdict:** 🔴 **NO-GO**

---

## Verdict: NO-GO — 4 open Blockers

Two of the four Blockers are new findings that the 2026-07-06 audit did not report; one is a
four-week-old Blocker that is still open and is **worse** than its own documentation says.

### Blocking items, most severe first

**1. An unauthenticated Server Action executes against production** *(Security · Blocker · CONFIRMED live by the orchestrator)*

A `POST` carrying `Next-Action: 403f8aed…` with **no session cookie at all** returns `200 OK`
and the action's real return value:

```
0:{"a":"$@1","f":"","b":"UPlxK5KEHfqYwdcsiDT9D"}
1:{"items":[],"nextCursor":null}
```

`getListings` (`src/lib/listings-query.ts:57`) never calls `requireSession()`. The result set is
empty *only* because no listing is currently in `active` status — **every active listing, asking
price and location becomes world-readable the moment a listing is approved.** A second action,
`triggerAlertMatching` (`src/lib/alert-actions.ts:233`), is also unguarded and fans out email to
every matching alert subscriber; it was not executed because that would send real mail.

→ Add `await requireSession()` as the first statement of every exported function in a
`"use server"` module, or move query helpers out of those modules so they aren't addressable
as endpoints.

**2. Production deployment does not match intent — three ways** *(Security · Blocker · all three CONFIRMED)*

- **Every production email is being redirected.** `EMAIL_OVERRIDE` is set for Production, and
  `src/lib/email.ts:94` reads `const recipient = override || to` with **no environment gate** —
  directly contradicting the comment six lines above it ("In production, always send to the real
  recipient"). Seller reminders, buyer inquiry replies, alert matches and brand-request mail all
  land in one inbox, which also accumulates other people's PII and live 72-hour `markSold` action
  tokens that are not single-use.
- **Middleware has never run in production.** `middleware.ts` sits at the repo root while the app
  lives in `src/app`; Next requires `src/middleware.ts` when a `src` directory is used, so the file
  is silently ignored. Two independent proofs: the production build's route table lists all 42
  routes with **no `ƒ Middleware` entry**, and unauthenticated GETs of nonexistent paths return
  **404 instead of the 307-to-`/login`** that `authorized()` would force (`/admin/zzz-nope` → 404).
  `src/auth.config.ts:31-38` is dead code and `PUBLIC_PATHS` is fiction.
- **Preview shares the production database.** `DATABASE_URL` is provisioned for Preview as well as
  Production, so preview deployments read and write live data.

→ Remove `EMAIL_OVERRIDE` from Production *and* make the code fail safe. Move `middleware.ts` to
`src/middleware.ts` — but re-verify carefully, because switching it on will start enforcing rules
that have never run (note `/` and `/browse` are **not** in `PUBLIC_PATHS` yet are reachable today).
Point Preview at its own branch database.

> **Nothing is exposed by the middleware gap today** — every protected surface happens to carry its
> own `auth()` guard (admin and seller via `layout.tsx`, `/account/*` per page, all nine API routes;
> two of them even comment *"Defense-in-depth"*, showing the author believed middleware was primary).
> The defect is the complete loss of defense-in-depth: any page or route added tomorrow without an
> explicit guard ships **public by default**.

**3. Schema migrations are broken, not merely drifted** *(Code Quality · Blocker · CONFIRMED, worse than documented)*

Four tables live in production and in `src/db/schema/**` with **no `CREATE TABLE` in any
migration**: `owner_locations`, `login_events`, `listing_views`, `competitor_alert_log`. The
`listing_locations` column rename and five declared indexes are likewise unmigrated. Critically,
`drizzle/0008_owner_locations_coord_source.sql:1` runs `ALTER TABLE "owner_locations"` against a
table no migration creates — so **`npm run db:migrate` against a fresh database fails at 0008**.
Disaster recovery and standing up any new environment are broken right now.

`drizzle/RECONCILE.md` still reads *"Status: OPEN — must be completed before launch."* Its
prescribed `0005_reconcile_drift` was never written (that slot went to `0005_user_owner_links`), and
its prescribed CI drift detector was never added. **This is the same Blocker raised on 2026-07-06.**

→ Follow RECONCILE.md's own procedure, and make sure the reconciliation migration sorts **before**
0008 (or make 0008 idempotent), or fresh migrates still fail.

**4. Server Actions neither re-check auth nor validate input** *(Security · escalated High → Blocker per gate rule 2)*

- The zod schemas in `src/lib/listings/schemas.ts` are wired **only** into the client
  react-hook-form resolver. Neither `saveDraft`, nor `adminUpdateListing`, nor the API wrapper
  (`src/app/api/listings/draft/route.ts:16-17`, which passes `await request.json()` straight
  through) ever calls `parse`/`safeParse`. Every constraint is bypassed by posting directly.
- **Verified financials are mass-assignable.** `src/lib/listings/persist.ts:158-159` writes
  `ttmRevenue` and `mcr` verbatim from the client payload — contradicting that function's own
  header comment (*"a seller must not be able to attach a higher-performing location's
  financials"*). Server-side re-derivation was implemented for `bqLocationName` but not for these
  two, which are exactly the numbers the listing card presents as verified from Hello Sugar's own
  reporting.

---

## Four-Pillar Summary

| Pillar | Pass | Fail | N/A | Open Blockers | Open High |
| :---- | :----: | :----: | :----: | :----: | :----: |
| UI/UX & Functional QA | 8 | 2 | 4 | 0 | 1 |
| Security & Deployment | 9 | 7 | 2 | 3 | 3 |
| Code Quality & Tech Debt | 9 | 7 | 0 | 1 | 1 |
| Brand Conformance | 11 | 3 | 0 | 0 | 1 |
| **TOTAL** | **37** | **19** | **6** | **4** | **6** |

**Gate:** Rule 1 (zero Blockers) **FAILED** — 4 open. Rule 2 (auto-escalation) applied to
authentication, production deployment, schema migrations, and the Server-Action boundary. Rule 3
(High items ticketed with owner + date) **not met** — 6 open High, untracked.

---

## Open High items

| # | Pillar | Item |
| :-: | :---- | :---- |
| 1 | Security | **Dependencies** — 2 critical + 5 high. `next-auth@5.0.0-beta.31` carries the Auth.js *"config errors can cause existence-based auth checks to fail open"* advisory, and `src/auth.config.ts:37` is exactly such a check (`return !!auth`). |
| 2 | Security | **Session endpoint leaks PII and the session token** — `/api/auth/session` returns the raw DB session + user row, including `sessionToken` in cleartext, defeating HttpOnly for token theft (paired with `script-src 'unsafe-inline'`). Cause: `src/auth.ts:62` returns `session` wholesale instead of a projection. |
| 3 | Security | **No error monitoring in production** — Sentry is fully wired in code but no DSN exists in Vercel Production, so every init is skipped and day-one failures are captured by nothing. |
| 4 | Code Quality | **Env access bypasses the validated module** — `auth.config.ts:20-21` reads `process.env.AUTH_GOOGLE_ID!`/`SECRET!` directly; four map components read `NEXT_PUBLIC_MAPTILER_API_KEY` directly. |
| 5 | UI/UX | **Brand-request form has no real validation** — `/account/brand-requests/new` shows no app-styled inline errors (native tooltips only) and the Website field is `type="text"` with no pattern, so `not-a-url` passes. |
| 6 | Brand | **Contrast violation on `/login`** — blush `#F7DCDA` on crimson `#ED1845` at 14px/600 measures **~3.34:1**, below the 4.5:1 needed at that size. |

### Notable Medium — accessibility contrast fails app-wide

Worth calling out because it's systemic rather than incidental. An authenticated axe scan of 9 routes
found **exactly one rule firing — `color-contrast` — but on all 10 page-states, 116 nodes.** Every
other clause of the check passes cleanly: zero `label`, `image-alt`, `link-name`, `button-name` or
`aria-*` violations, every `<img>` has alt text, real Tab traversal reaches every control with a
visible focus ring, and there are no click-handler `<div>`s or positive `tabindex`. The failures
trace to **design tokens, not one-off mistakes**:

| Ratio | Needs | Pair | Where |
| :-: | :-: | :---- | :---- |
| **2.14** | 4.5 | `#B0988D` on `#EEE2DA` | `.divider-text > span` "Authorized users only" (`globals.css:894`) |
| **2.71** | 4.5 | `#B0988D` on white | `text-gray-400` body copy — `--gray-400` (`globals.css:82`) is used in **71 places across 39 files** |
| **2.92** | 4.5 | `#B9772E` on `#F3E4D0` | warning chip, `CompetitorList.tsx:73-74` |
| **3.72** | 4.5 | `#FDE8EC` on `#ED1845` | inactive header pills — 19 nodes, `HeaderNav.tsx:96` |
| **4.35** | 4.5 | `#ED1845` ↔ white | the brand primary itself (`globals.css:38`) — active nav pill, `<h1>`, every primary button (~27 nodes) |

The last row is a near-miss the whole design system rests on: darkening `--hs-red-600` a few percent
clears ~27 nodes at once. The `gray-400` and amber cases are not near-misses and need real value
changes. This also **supersedes and widens the Brand contrast High** above, which had found only the
single 3.36:1 login-hero instance.

Performance, by contrast, passes: **CLS is 0.000–0.029 on every run**, desktop Performance 85–90 with
FCP 0.4 s / LCP 1.0 s / TBT 230–320 ms, server response 50–70 ms, page weight under 482 KiB. Mobile
medians are acceptable (~80–88, LCP 3.0–4.3 s). Two catastrophic mobile samples carried Lighthouse's
own "tested device has a slower CPU than expected" warning and are host noise, not the app.

Remaining Medium and Low findings (abuse protection, duplicate middleware files, dead code, redundant
deps, token-file drift, root-level scratch docs, lint ratchet, rejected-badge status color) are
itemised with evidence and fixes in `audit-report.json`.

---

## Audit caveats — read before trusting the coverage

1. **This ran against live production with real business data.** All state-changing writes were
   withheld. Checks that can only be proven by a destructive write are marked N/A or graded from
   source, with the reproduce command recorded as **not run**. Nothing in this report was verified
   by mutating production.
2. **The supplied session cookie stopped authenticating partway through.** At merge time that
   cookie returns 307→`/login` on `/admin` and 401 on `/api/listings`. Authenticated findings were
   captured while it was valid, so **authenticated-surface coverage is capped** — re-audit with a
   fresh cookie.
3. **User A was an admin**, so object-level authorization (IDOR) could not be graded; an admin
   legitimately reads org-wide. No User B resource IDs were supplied and none existed to discover.
   Static review found no ownership gap, but this needs a re-run with a non-admin cookie.
4. **Personal-Gmail sign-in was not reported back**, so company-domain restriction is graded from
   source only (`src/auth.ts:22-44` rejects non-Google, requires `email_verified`, allows the
   workspace domain else an allowlist row).
5. **Accessibility and Lighthouse were recovered** after the initial axe run died on a
   ChromeDriver/Chrome version mismatch. A second pass drove Playwright's own bundled Chromium with
   `@axe-core/playwright` and scanned **9 routes authenticated** (verified as real gated renders, not
   login redirects). Results are in the two rows below and in `audit-report.json`. The one gap left:
   there is **no valid Lighthouse measurement of authenticated `/browse`** — the single run that
   reached it landed on an error boundary (a `--disable-gpu` flag killed WebGL2), and the session
   died before it could be redone. `/browse` carries the WebGL map and is the likeliest place jank
   would live, so the performance Pass should be re-confirmed there with a fresh token.
6. **One auditor claim was refuted.** The security auditor concluded root `middleware.ts` was live,
   inferring it from `/action-complete` → 200; that inference does not distinguish "middleware
   allows it" from "no middleware at all". The orchestrator's build-output and 404 evidence
   established the latter, and the report reflects the correction.

### Previously-blocking item now fixed

The 2026-07-06 Blocker *"seller wizard cannot advance past Financials"* **appears fixed in source** —
`stepSchemas` plus per-step `safeParse` replaced the `.and()` intersection
(`src/lib/listings/schemas.ts:96`, `src/components/listings/ListingWizard.tsx:70-88`). It was not
confirmed end-to-end live because that requires a real write, so it should be the first thing
re-tested on staging.

---

## Out-of-scope observations

Context for follow-up, not graded findings.

- **UI/UX** — Generic `<title>` on several inner pages; deprecated MapTiler style `Streets Default v2`
  warns on `/browse`; `/seller/listings` skips the index for single-listing sellers; `/` and
  `/browse` return 200 logged out and flash the skeleton before redirecting. **The map does not
  degrade gracefully:** with WebGL2 unavailable it throws and takes the *entire* `/browse` page down
  to a "Something went wrong" boundary rather than falling back to the list view.
- **Security** — The GitHub repo is **public** for an internal tool (no secrets tracked, so not a
  leak, but worth a deliberate decision); all 24 server-action ids ship in the public bundle;
  gitleaks/trufflehog could not be installed so secret scanning used secretlint plus regex sweeps
  of the live chunks and full git history (clean); two harness probes returned false results and
  need tightening.
- **Code Quality** — `neon-http` has no `db.transaction`, so multi-table writes depend on
  `db.batch`; DEBT-025, DEBT-028 and DEBT-017 are all still open in code comments.
- **Brand** — All logos are raster PNG though a vector `hs-logo.svg` ships unused; the login focus
  ring uses `#EF3059` rather than the exact `#ED1845` focus token; the script font is never loaded.

---

**Go / No-Go:** 🔴 **NO-GO** · **Auditor:** pre-launch-audit v0.2 (Fable 5 orchestrator) · **Date:** 2026-08-03
