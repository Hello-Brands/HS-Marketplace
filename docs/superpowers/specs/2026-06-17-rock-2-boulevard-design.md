# Rock 2 — Wire real Boulevard data (total sales + MR%) into listing details

**Date:** 2026-06-17
**Branch:** `rock-2`
**Status:** Design approved — pending spec review

## Goal

Replace the mock KPI / financial data on listing detail pages with **real Boulevard
data** so the page stops advertising "live data" that is actually fabricated. In this
Rock, "real" means **total sales (revenue)** now and **membership rate (MR%)** once its
definition is confirmed. **Profitability stays a manual seller-entered field.**

Two framing constraints:

1. **The keystone is the join key** — a reliable `listing → Boulevard location` mapping.
   A wrong mapping leaks the wrong location's financials, so the mapping must be
   human-confirmed and the fetch path must read it only when confirmed.
2. **Profit stays manual.** Boulevard auto-populates revenue and (later) MR%; `ttmProfit`
   remains owner-entered and is never auto-populated.

## Non-goals

- New Clients and Bookings KPIs are **not** wired to real data this round.
- Profit/profitability auto-population.
- A scheduled daily sync job into a `location_kpi` table (explicit later optimization;
  on-demand cached fetch is sufficient given few listings).
- MR% implementation is **stubbed** until its definition lands (see Decisions / Task 0).

## Decisions (from brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Boulevard access state: **credentials exist, query not yet proven** | Port auth/client now; iterate the actual GraphQL query against the live API together. Claude can't call Boulevard, so the query string is isolated for the user to run/paste responses during iteration. |
| D2 | New Clients & Bookings cards: **keep, badge "Sample — not live"** | Preserves the dashboard layout while being honest that those two are not real. |
| D3 | MR% card: **kept but stubbed + badged "pending"** until Task 0 definition returns | MR% is the long-pole human dependency; stub the interface so wiring it later is a localized swap. |
| D4 | Join-key confirmation: **Approach C (Hybrid)** | Hard confirm-at-approval gate AND a durable admin mappings/backfill screen; fetch reads only `confirmed` mappings. |
| D5 | Name-match suggestion computed **at approval time** (re-runnable in mappings screen) | Avoids storing stale suggestions; BLVD location list stays current. |
| D6 | Mock data demoted to an **explicit dev-only flag**, never the default fetch path | The whole point is to stop serving fake data by default. |

## Architecture / module boundaries

- **`src/lib/boulevard/client.ts`** (server-only): Admin GraphQL API auth from env; the
  GraphQL **query string isolated in one place** so it can be iterated without touching
  callers. Exposes:
  - `fetchMonthlySales(boulevardLocationId, months): Promise<MonthlySales[] | null>`
  - `fetchMembershipRate(boulevardLocationId): Promise<MembershipRate | null>` — **stubbed** this round.
  - Uses `AbortController` timeout; any error (network, non-200, validation) returns
    `null` for graceful degradation; responses are **Zod-validated**.
- **`src/lib/boulevard/types.ts`**: Zod schemas + inferred types.
- **Env (server-only, never `NEXT_PUBLIC_`)**: `BOULEVARD_API_URL`, `BOULEVARD_API_KEY`
  (+ business id if the auth shape requires it). Added to `.env.example` (placeholders)
  and Vercel. Exact auth shape confirmed during Task 2.

## Data model (Task 1)

Additive, **properly journaled** migration (the baseline is now coherent post-Rock-1)
on `listing_locations`:

- `boulevard_location_id text` — nullable.
- `boulevard_mapping_status text` — one of `unconfirmed | confirmed | not_connected`,
  default `unconfirmed`.

**Safety invariant:** real Boulevard data is fetched **only when
`boulevard_mapping_status = 'confirmed'`**. Any other status → "not connected" UI state.

## Join-key workflow (Approach C — Hybrid)

1. **Suggestion** (at approval time, re-runnable): fetch Boulevard's location list, match
   by canonical BLVD name (the name already treated as canonical), prefill the suggested
   `boulevard_location_id` with status `unconfirmed`.
2. **Approval-queue gate:** for each **salon** location on a pending listing, the admin
   sees a Boulevard-location dropdown (prefilled to the suggestion). The admin must set
   status to `confirmed` (with a chosen id) or `not_connected` **before the listing can be
   approved/go active**. (Territory locations are exempt — no Boulevard data.)
3. **Admin "Boulevard mappings" screen:** a table of all salon `listing_locations` with
   their current mapping + status; confirm / override / clear. This is the **backfill**
   path for existing active listings and the re-map path going forward.

## Revenue: real (Task 3)

- `kpi/fetch.ts` revenue metric ← `boulevard.fetchMonthlySales` keyed by the **confirmed**
  `boulevard_location_id`.
- `FinancialsGrid` "TTM Revenue" = sum of trailing-12-month sales across the listing's
  confirmed salon locations.
- **Fallback:** a location with no `confirmed` mapping renders "Not connected to
  Boulevard" — no numbers, no crash.
- **Mock:** retained only behind an explicit dev flag (e.g. `KPI_USE_MOCK=1` / when creds
  absent in local dev), never the default production path.
- **Profit:** `ttmProfit` stays manual and untouched.

## KPI cards disposition

| Card | This round |
|------|------------|
| Revenue | **Real** (Boulevard total sales) |
| Membership Conversion (MR%) | **Stubbed**, badged "pending" until Task 0 |
| New Clients | Kept, badged "Sample — not live" |
| Bookings | Kept, badged "Sample — not live" |

## MR% (Task 4 — stubbed)

`fetchMembershipRate` interface exists and returns a stub/`null`; the MR% card is badged
"pending" until implemented.

**MR% definition (confirmed 2026-06-17):** per location, per month —
**new members in the period ÷ unique clients with an order in the same period.** Both
sides are location- and date-filterable in Boulevard. Card shows the last full month with
a 12-month trend (one ratio per month). Implementing it is a localized change behind the
existing interface.

## Caching & freshness (Task 5)

- Wrap Boulevard calls in `unstable_cache` with a **daily** `revalidate` (≈86400s) + cache
  tags, so we don't hit the API per page view and stay within rate limits.
- Show an **"as of [date]"** timestamp on real metrics so the numbers read as trustworthy.
- Future optimization (not now): scheduled daily sync into a `location_kpi` table via the
  existing cron, if latency or rate limits bite.

## Data-source signals + truthful copy (Task 6)

- Mark Boulevard-sourced fields with a small **"Boulevard"** indicator (Revenue; later
  MR%) vs seller-entered fields (Asking Price, Profit).
- Update the listing page's "live data" copy so it is accurate — it now describes only the
  genuinely live fields.

## Access control (rides along — do not skip)

The moment real dollars flow, verify the fetch path:

- Returns Boulevard data **only for `active` (listed) locations** via a **`confirmed`**
  mapping — never for draft / pending / rejected / sold listings, and never for
  `unconfirmed` / `not_connected` mappings.
- Respects role / `sellerAccess` wherever the KPI fetch is reachable.
- Backed by a **regression test** asserting non-active or non-confirmed → no fetch / no
  data leak.

## Testing / quality

- **Mock the Boulevard client** in tests (mirror Rock 1's approach).
- Cover: name-match suggestion, the confirm-at-approval gate, fetch-only-on-`confirmed`-
  and-`active`, the "not connected" fallback, the `unstable_cache` wrapper (pass-through
  in tests), and the access-control guard.
- `typecheck` and `build` clean; no secrets in the diff; `.env.example` updated with
  placeholders only.

## Sequencing

1. **Task 1** — schema + join-key workflow (migration, approval-queue gate, mappings
   screen, backfill).
2. **Task 2** — Boulevard client (auth + isolated query + Zod + timeouts).
3. **Task 3** — swap mock revenue for real; "not connected" fallback; wire `FinancialsGrid`.
4. **Task 5** — caching + "as of" freshness.
5. **Task 6** — data-source signals + truthful copy.
6. **Access control** — folded in throughout, with its regression test.
7. **Task 4 (MR%)** — stubbed now; implemented when **Task 0** (definition) returns.

**Task 0** (get the MR% definition from Haley/Austin) runs in parallel from day one — it's
the only piece gated on a human answer, so it must not block at Task 4.

## Open items / risks

- **Revenue trend granularity:** the 12-point trend chart needs Boulevard **monthly**
  sales, not just a single TTM total. The client is designed around a monthly series
  (TTM = sum). If only a TTM total is available, the trend line stays "sample" and only the
  TTM number goes real — resolved during Task 2/3 query iteration.
- **Boulevard auth shape:** exact credential/header format confirmed when porting the
  client (Task 2).
- **MR% definition:** external dependency (Task 0); blocks only Task 4.
