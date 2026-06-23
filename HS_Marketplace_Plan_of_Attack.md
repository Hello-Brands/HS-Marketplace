# HS Marketplace — Plan of Attack

A roadmap to take the Hello Sugar Marketplace from idea → prototype → production.

---

## The big-picture reframe

This feels bigger than it is because it's new and the meeting threw a lot at you at once. But ~80% of it runs on the **exact stack you already shipped the onboarding tracker on**: Next.js App Router, TypeScript, Drizzle, Neon/Postgres, Tailwind, Vercel, Hello Sugar GitHub org.

There are really only **two new muscles** to build:

1. **Geospatial** — the map + radius search (the "Zillow" part).
2. **Scheduled background jobs** — the Sunday competitor scraper.

Retire those two unknowns early and the rest is familiar territory.

---

## What you're actually building (two products in one)

Austin described two distinct tools. Keep them mentally separate — they have different data, different risk, and a clear build order:

- **A — The Selling Marketplace** ("Zillow for HS"). Owners list territories, single locations, or groups (suite vs. flagship) for sale. Map-based browse, radius search, saved searches + alerts, listing detail with key metrics. *Austin's "quicker win" — build first.*
- **B — The Discovery / Scraper.** A Sunday job monitors ~15–20 competitor franchises (European Wax, Radiant Wax, etc.) for closed locations that could be converted to HS. *The "exciting one" — build second.*
- **C — Outreach automation** (long-term). Auto-reach-out to closing locations, the way Austin sourced Sugarhouse from a closed Amazing Lash Studio. *Later, and human-gated.*

---

## Recommended tech stack

**Reuse what you already run** (don't re-learn anything mid-stress):

- Next.js App Router + TypeScript
- Neon Postgres + Drizzle ORM
- Tailwind + the `hello-sugar-brand` skill
- Vercel (Hello Sugar org)

**Add these for the marketplace, and why:**

- **Auth.js (NextAuth), Google provider** — slots straight onto the OAuth Austin is reconfiguring. Gate access to *approved* owners with an allowlist table (see the auth note below — OAuth alone isn't enough).
- **Google Maps Platform (Maps JS + Places API)** — keeps Maps, Places, and OAuth under one Google billing account, and Places is your closure-detection data source anyway. *Mapbox GL is the alternative if you want nicer map styling later; you can swap the display layer without touching the data.*
- **PostGIS on Neon** — store a `geography(Point)` per location; radius search becomes a clean `ST_DWithin` query. (If you want to avoid PostGIS at first, store lat/lng and do a Haversine bounding-box query — but PostGIS is the right long-term call, and Drizzle can issue the raw SQL.)
- **Vercel Cron** for the Sunday scraper to start. When the scraper grows (per-site retries, observability), graduate to **Inngest** — built for Next.js, gives you durable steps + retries + a dashboard, and it's the natural home for the V4 outreach automation.
- **Boulevard GraphQL Admin API** (sales, memberships) + **Google Places API** (reviews + `business_status` for closures).
- **Resend** for saved-search email alerts (clean DX, fits the stack).
- **Zod** at every API / external-data boundary.
- **Sentry** + Vercel logs for monitoring.

---

## Do this FIRST: two de-risking spikes

Before building any real UI, run two throwaway spikes (a day or two each). Their only job is to retire the two biggest unknowns:

**Spike 1 — Boulevard data.** This is the single biggest risk in the whole plan. Confirm:
- (a) HS actually has the Boulevard **API package** provisioned, and
- (b) you can pull **total sales** and the inputs for **MR%** for a *single* location via the Admin API.

If MR% isn't a direct field, figure out how to compute it from membership + client data now — don't discover that in V2. *Note: the products query returns retail products, memberships, and packages, but Boulevard recently split memberships/packages into their own APIs — use the newer membership-specific queries, not the legacy product query.*

**Spike 2 — Maps + geospatial.** Get a map rendering with a handful of seeded location pins and a **working radius filter** (`ST_DWithin`). Prove the Zillow-style interaction before you build UI around it.

Both are disposable. You're buying certainty, not shipping anything.

---

## Order of operations — week 1 (unblocking)

You're currently blocked on Austin for two things. Chase them politely but promptly:

- **Repo transfer** → from Austin's personal (public!) account to the HS org, with access granted to you.
- **OAuth reconfig** → so marketplace login works.

While that's in flight:

- **Audit Austin's existing build before rebuilding anything.** This is a personal side-project repo — read the schema and the working parts, then decide keep-vs-rebuild. Don't assume greenfield; don't assume it's solid either.
- **Security check (do this regardless):** the repo is *public on a personal account today*. Scan git history for any committed secrets — OAuth client secrets, DB URLs, API keys. If anything leaked, **rotate it**. Making the repo private later does *not* undo public git history.
- Stand up local dev on the existing stack and get OAuth login working end-to-end.

**You're waiting on (from the meeting's action items):**
- Austin → redo Google auth
- Austin → transfer repo + grant you access
- Austin → follow up to confirm you have everything
- Coleman → send the recurring Tuesday meeting invite

If Austin's follow-up didn't land, the repo + OAuth are your blockers — nudge on those specifically.

---

## The phased roadmap

### Phase 0 — Prototype / spikes
The two spikes above + the repo/OAuth unblock.
**Done when:** you can log in, see a map with seeded pins and a working radius filter, and you know exactly which Boulevard metrics you can fetch.

### V1 — Selling Marketplace MVP (the quick win)
- OAuth-gated to approved owners.
- Listings: create / edit / unpublish for a **territory**, **single location**, or **group**; type = suite or flagship.
- Map browse (pins) + list view + **radius search**.
- Listing detail with the four metrics — **manually entered / seeded for now**: total sales, MR%, Google reviews, profitability.
- **Saved searches + alerts** (in-app first; email comes in V2).
- On-brand UI via the brand skill.

**Done when:** a real owner can list a location and another owner can find it by map/radius and view its detail. Ship it internally and watch people use it.

### V2 — Real data + polish
- Wire **Boulevard API** → auto-populate total sales + MR%. Keep **profitability manual** — it's the one judgment field.
- Wire **Google Places** → auto-populate reviews (cache aggressively to control cost).
- Saved-search **email alerts** via Resend.
- Listing photos, richer filters/sort, a buyer → seller inquiry/contact flow.

**Done when:** metrics populate themselves and owners get notified of new matches without you touching anything.

### V3 — Discovery / scraper (the exciting one)
- **Sunday cron** checks your tracked ~15–20 competitor locations via **Google Place ID → `business_status`** (`CLOSED_PERMANENTLY` / `CLOSED_TEMPORARILY`). Place ID over raw site-scraping = fewer false negatives *and* stays within an API's ToS.
- Surface flagged closures as **conversion opportunities** on the same map, with the suite-owner framing ("move into a flagship without the ~$400K build-out").
- **Secondary:** let owners add custom local businesses to track, with **self-serve guardrails** (cap the count, validate the Place exists, soft limits) so it doesn't become an admin burden.
- Move the job to **Inngest** if Vercel Cron starts straining.

**Done when:** closures are detected weekly and shown without manual checking, and owners can safely self-add watch targets.

### V4 — Outreach automation (long-term)
- Automated outreach to closing locations (the Sugarhouse-from-Amazing-Lash play). This is where your remote-agent / LLM work pays off — drafting and sequencing.
- **Gate behind a human + a legal check.** Cold B2B outreach has CAN-SPAM / deliverability / brand-reputation implications. Start human-in-the-loop: **AI drafts, a person sends.**

**Done when:** a detected closure can trigger a drafted, human-reviewed outreach.

---

## Production-readiness checklist

Fold these into V1/V2 — don't bolt them on at the end.

- **Access control on financial data (the #1 thing to get right).** Sales and profitability are sensitive. A seller listing their location is opting in to sharing — but make sure you never leak financials for locations that *aren't* listed. Decide explicitly who sees whose numbers.
- **Secrets** in env vars / Vercel project settings, never in the repo. Rotate anything that ever touched the public repo.
- **Cost controls on the Places API.** Cache results, only refresh on the weekly job, and set a billing budget + alert. Places calls add up fast across radius searches + weekly multi-location checks.
- **Cron reliability.** Make the Sunday job idempotent, log every run, and alert on failure. A silently-dead scraper is worse than no scraper.
- **Observability.** Sentry + structured logs from day one.
- **Testing.** At minimum, cover the geospatial query and the Boulevard/Places data mappers.
- **Backups.** Use Neon branching / point-in-time recovery — you're now holding business-critical financial data.

---

## Questions to follow up on (send to Austin / Coleman)

You said you weren't sure what to ask. These are the gaps the meeting left open, ordered by how much they change the build.

**Scope / product — biggest lever:**
- Is the marketplace just **discovery + connecting** buyers and sellers, or does it ever handle the actual **transaction** (offers, docs, payments)? Payments = an entirely different scope; confirm it's out of scope for now.
- Who exactly gets access — **only HS franchise owners**? How do we verify someone is an owner? (Owners often log in with personal Gmail, which is why OAuth alone isn't enough — you'll likely need an allowlist.)
- **Internal-only forever**, or could it go public / customer-facing later? Affects auth and data-exposure decisions you're making now.

**Data / integrations — biggest risk:**
- Do we have the **Boulevard API package** provisioned, and can we pull **total sales** and the inputs for **MR%** per location? If MR% isn't a direct field, how is it defined (numerator / denominator / time window)?
- Who owns the **Google Cloud billing** account for Maps + Places, and is there a budget?
- What's the canonical **join key** linking a marketplace location to its Boulevard data and its Google Place? (You already treat the BLVD name as canonical naming in the onboarding tracker — is there a stable BLVD location ID *and* a stored Place ID?)

**Scraper:**
- Is there a **defined list** of the ~15–20 competitor franchises, and who maintains it?
- Anything about monitoring competitors / using their Place data we should clear with **legal**? (Places API = fine; direct site-scraping is the riskier path you're already avoiding.)

**Logistics / success:**
- Is there a **timeline or deadline** (owner conference, fiscal milestone)? What does **success in 90 days** look like — # listings, # active owners, first deal closed via the tool?
- Is this **just you** building, or is Coleman contributing code vs. coordinating?
- Confirm the **priority order**: selling tool first, scraper second — yes?

**The one strategic question:**
- Who's our **design partner** — the specific owner we build V1 *with* and validate against? Building for one real first user beats building for "owners" in the abstract.

---

## Driving it with Claude Code + Superpowers + UI/UX

- Turn this roadmap into a short **PRD/spec per phase** and feed Claude Code structured prompts — same structured-JSON move you used for the marketing checklists. Scope each session to **one feature**, not the whole app.
- Pull in the **`hello-sugar-brand` skill** on every UI session so the marketplace is on-brand from the first screen.
- **UI/UX Max** for the high-visibility surfaces (the map, listing cards, detail page); **Superpowers** for the heavy lifts (geospatial queries, Boulevard/Places integration, the cron pipeline).
- **Reuse patterns from the onboarding-tracker repo** — Drizzle schema conventions, Vercel/Neon setup, auth scaffolding — so you're not re-solving solved problems.

---

## If you only do three things this week

1. **Unblock:** chase Austin on the repo transfer + OAuth, and audit his existing build before writing new code.
2. **De-risk:** run the Boulevard data spike — confirm API access and which metrics you can actually fetch.
3. **Prove the map:** stand up a map with seeded pins + a radius filter.

Everything else follows from those three.
