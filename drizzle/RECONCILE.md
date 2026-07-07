# Migration drift reconciliation (pre-launch audit 2026-07-06)

**Status: OPEN — must be completed before launch. This is the schema-migrations Blocker.**

## What's wrong

Production schema was updated with `drizzle-kit push` instead of tracked migrations, so
the committed migrations (`0000`–`0004`) do **not** describe the current schema. Specifically,
these exist in `src/db/schema/**` and in the live prod DB but in **no** migration file:

- **Four tables** with no `CREATE TABLE` in any migration:
  `owner_locations`, `login_events`, `listing_views`, `competitor_alert_log`
- **A column rename** on `listing_locations` (migration `0001` added the old names):
  `boulevard_location_id` → `bq_location_name`, `boulevard_mapping_status` → `data_mapping_status`
- **Five indexes** declared in the schema but never migrated:
  `listings_status_created_at_idx`, `listings_seller_id_idx`, `favorites_listing_id_idx`,
  `listing_locations_listing_id_display_order_idx`, `listing_photos_listing_id_display_order_idx`

## Why this can't be auto-generated in the agent/CI environment

`drizzle-kit generate` needs an interactive **TTY** to resolve the `boulevard_*` → `bq_*`
change (it must ask "renamed, or drop + add?"), and there is no non-interactive flag for it.
Baselining prod also needs the prod connection. Run the steps below at a real terminal.

## Recurrence is already prevented

- `npm run db:push` is now wrapped by `scripts/db-push-guard.mjs`, which **refuses to push to a
  non-local database** (override only with `ALLOW_REMOTE_PUSH=1`).
- Add the CI drift detector below once `0005` is generated.

---

## Procedure (run locally, with prod's direct URL available)

Environment (from the gitignored `.env.local` — see the DB-migrations memory):
`DATABASE_URL_DIRECT` = prod **direct** (non-pooled) URL.

### 1. Confirm prod's real shape first (introspect — read-only)

```bash
npx drizzle-kit pull   # writes an introspected snapshot; compare it to src/db/schema/**
```

Verify prod actually has the four tables + the `bq_*` columns + the five indexes. If prod is
missing any of them, the reconciliation SQL below must be *run*, not just marked applied.

### 2. Generate the reconciliation migration (answer the rename prompt)

```bash
npm run db:generate -- --name reconcile_drift
```

When prompted about `listing_locations` columns, choose **rename**:
`boulevard_location_id → bq_location_name`, `boulevard_mapping_status → data_mapping_status`.
This writes `drizzle/0005_reconcile_drift.sql` (CREATE TABLE ×4, ALTER … RENAME COLUMN ×2,
CREATE INDEX ×5) **and** the matching `drizzle/meta/0005_snapshot.json` + `_journal.json`
entry. Review the SQL before applying.

### 3. Reconcile prod — baseline, don't re-run

Prod already has these objects, so **do not execute** `0005` against prod (it would error on
existing tables). Instead record it as applied so future `db:migrate` runs skip it:

- Preferred: insert the `0005` hash into drizzle's migrations bookkeeping table
  (`drizzle.__drizzle_migrations`) with the same tag/hash the runner expects, matching how the
  2026-06-16 re-baseline was done. Confirm the hash the runner computes before inserting.
- If step 1 showed prod is actually **missing** something, run only the specific
  `CREATE TABLE`/`CREATE INDEX`/`RENAME` statements prod lacks, then baseline the rest.

Fresh/local databases run `0000`→`0005` normally and end at the correct schema.

### 4. Add the CI drift detector (commit with `0005`)

Add to `.github/workflows/ci.yml` after the Typecheck step (dummy URL — `generate` never
connects):

```yaml
      - name: Migration drift check
        env:
          DATABASE_URL_DIRECT: postgres://ci:ci@localhost:5432/ci
        run: |
          npx drizzle-kit generate --name __drift_check__ || { echo "::error::schema and migrations drifted — run npm run db:generate and commit the migration"; exit 1; }
          if ! git diff --quiet drizzle/; then
            echo "::error::uncommitted migration produced — schema drifted from committed migrations"; git status --porcelain drizzle/; exit 1
          fi
```

When migrations are in sync, `generate` prints "No schema changes" and exits 0; any drift either
emits a file (caught by `git diff`) or hits the TTY error (non-zero exit) — either way CI fails.

### 5. Verify

`npm run db:migrate` against a fresh scratch DB should apply `0000`→`0005` cleanly and match
`src/db/schema/**`; against prod it should report nothing pending.
