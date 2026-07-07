# HS-Marketplace

Internal marketplace for buying and selling Hello Sugar franchise locations — browse listings on a map, sellers create/submit listings, admins review and approve, with KPI/financial context pulled from BigQuery. Next.js (App Router) + Drizzle/Neon Postgres + NextAuth (Google), deployed on Vercel.

## Stack

- **Next.js 15** (App Router, React 18) — see `AGENTS.md`: this repo tracks a modified Next.js; read the guides under `node_modules/next/dist/docs/` before writing framework code.
- **Drizzle ORM** on **Neon** Postgres (`neon-http` driver — no transactions; use `db.batch` for atomic multi-writes).
- **NextAuth v5** (Google only), restricted to the `@hellosugar.salon` workspace domain (+ a DB allowlist).
- **Vercel** hosting: Blob storage, Cron. External: BigQuery, MapTiler, Resend.

## Setup

```bash
# Node 24 (see package.json engines)
npm install --legacy-peer-deps   # REQUIRED flag — matches vercel.json installCommand; plain `npm install` may fail
cp .env.example .env.local        # then fill in the values below
npm run dev                       # http://localhost:3000
```

## Environment variables

`src/lib/env.ts` (`@t3-oss/env-nextjs` + zod) is the **source of truth** and validates these at boot — a missing/invalid required var fails the build/start loudly. Tests set `SKIP_ENV_VALIDATION`.

**Required — server:** `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (direct, for migrations), `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `RESEND_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `ACTION_TOKEN_SECRET`, `CRON_SECRET`.

**Required — client:** `NEXT_PUBLIC_MAPTILER_API_KEY` (domain-restricted key), `NEXT_PUBLIC_APP_URL` (absolute base URL, e.g. `https://marketplace.hellosugar.salon` — used to build email/cron links).

**Optional / defaulted:** `GOOGLE_WORKSPACE_DOMAIN` (default `hellosugar.salon`), `INITIAL_ADMIN_EMAIL`, `EMAIL_FROM`, `EMAIL_OVERRIDE`, `MAPTILER_API_KEY` (server-side, unrestricted — for backfill/geocoding), `BIGQUERY_PROJECT_ID`, `GCP_SERVICE_ACCOUNT_JSON` / `BIGQUERY_CREDENTIALS` / `GOOGLE_APPLICATION_CREDENTIALS`, `HS_INTERNAL_API_URL`, `HS_INTERNAL_API_TOKEN`, `BOULEVARD_API_URL`, `BOULEVARD_API_KEY`, `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` (error monitoring — inert until set).

See `src/lib/env.ts` for the authoritative list and validators.

## Scripts

| Script | Purpose |
| :-- | :-- |
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm test` / `test:watch` | Vitest unit suite |
| `npm run test:e2e` | Playwright smoke suite (set `PLAYWRIGHT_BASE_URL`; never point at prod) |
| `npm run lint` | ESLint (enforced in CI) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply committed migrations (uses `DATABASE_URL_DIRECT`) |
| `npm run db:push` | **Guarded** — refuses non-local targets (see below) |
| `npm run db:studio` | Drizzle Studio |

## Database & migrations

**Schema changes go through tracked migrations — never `db:push` against a shared/prod database.** `db:push` mutates the schema directly without creating a migration file, which previously drifted production (see `drizzle/RECONCILE.md`). It is now wrapped by `scripts/db-push-guard.mjs`, which refuses any non-local target (override only with `ALLOW_REMOTE_PUSH=1` for a local scratch DB).

Workflow for a schema change:

```bash
# 1. edit src/db/schema/**
npm run db:generate      # writes drizzle/NNNN_*.sql + meta snapshot
#    review the generated SQL
npm run db:migrate       # apply to the target in DATABASE_URL_DIRECT
```

Migrations are **not** applied automatically on deploy — run `db:migrate` deliberately against the target. See `drizzle/RECONCILE.md` for the outstanding prod drift reconciliation.

## Deploy

Vercel builds with `npm run build` (install uses `--legacy-peer-deps`). Ensure all required env vars above (especially `NEXT_PUBLIC_APP_URL`) are set in the Vercel project, then apply any pending migrations with `db:migrate` before promoting.
