# Monday Lat/Lng as Source of Truth for HS Location Coordinates

**Date:** 2026-07-31
**Status:** Approved design, pending implementation plan

## Summary

BigQuery now exposes per-location coordinates maintained in the Monday board:
`even-affinity-388602.snowflake_data.vw_custom_monday_data_raw` (`Latitude`,
`Longitude`, keyed by `BLVD Location #`). These coordinates become the
**absolute source of truth** for Hello Sugar location pins on the `/browse`
map — both the unlisted-HS owner dots (`owner_locations`) and mapped listing
pins (`listing_locations`). MapTiler geocoding remains only as a fallback for
locations the view does not cover.

Coordinate application happens inside the existing owner-directory sync
(cron + admin button); running one sync after deploy is the backfill.

## Goals

- Monday coords win wherever they exist, re-applied on **every** sync
  (overwriting any prior value, whatever its source).
- Owner dots: join `owner_locations.blvd_location_number` →
  `TRIM(BLVD Location #)`.
- Listing pins: bridge confirmed salon locations
  (`listing_locations.bqLocationName` = `owner_locations.resolvedBqLocationName`
  → that row's `blvdLocationNumber` → Monday coords), at sync time and
  immediately when an admin confirms a mapping.
- Track provenance: which system produced each stored coordinate.
- Locations without Monday coverage keep today's MapTiler geocode path.

## Non-Goals (YAGNI)

- No sanity-checking, distance-flagging, or overriding of Monday values in
  code. Bad Monday data (e.g. Royal Oak #127, whose coords are in Ohio) shows
  verbatim and gets fixed **in Monday** (list of known-bad rows goes to the
  data team, outside this change).
- No changes to territory locations (`territoryLat/Lng` are user-drawn).
- No changes to unconfirmed/not-connected listing locations.
- No coords application in the seller draft-save path (BQ stays out of the
  interactive flow; the confirm-mapping hook + sync cover it).
- No admin UI for viewing/editing coordinates.
- No removal of the MapTiler geocoder or `/api/geocode` (still used for
  fallback, territories, and the browse location-search box).

## Context (verified 2026-07-31)

- The view has 323 rows; 321 with in-range coords. `Name` and
  `BLVD Location Name` columns are entirely NULL — `BLVD Location #` is the
  only usable key. 7 rows have an empty-string number and must be excluded.
  Real numbers are unique today, but the view wraps a *partitioned* snapshot
  table (`snowflake_data_tables.tbl_custom_monday_data_partitioned`) with a
  bare `SELECT *`, so the query dedupes by number defensively.
- 313/315 owner-directory rows join 1:1 by number. The view covers all 5
  owner rows that MapTiler never geocoded (#045, #218, #241, #015, #259).
- Compared with MapTiler for 308 locations: median disagreement 30 m; 45 rows
  >500 m apart; errors exist on both sides. User decision: Monday wins.
- `syncOwnerLocations` (`src/lib/owner-directory/sync.ts`) full-refreshes the
  mirror, preserves resolved mappings and coords across syncs, then runs a
  best-effort MapTiler backfill for rows with NULL latitude. Triggered by
  `/api/cron/sync-owner-directory` and an admin server action.
- `listing_locations` already has `geocodeSource`; `owner_locations` has no
  provenance column.
- Neon HTTP driver: no `db.transaction`; use `db.batch` for atomic
  multi-writes.

## Design

### 1. BigQuery coords query (`src/lib/bigquery/queries.ts`)

New `getMondayCoordsByLocationNumber(): Promise<Map<string, {lat: number;
lng: number}> | null>` following the existing query-module pattern:

```sql
SELECT TRIM(`BLVD Location #`) AS num,
       ANY_VALUE(CAST(Latitude AS FLOAT64))  AS lat,
       ANY_VALUE(CAST(Longitude AS FLOAT64)) AS lng
FROM `even-affinity-388602.snowflake_data.vw_custom_monday_data_raw`
WHERE Latitude IS NOT NULL AND Longitude IS NOT NULL
  AND TRIM(`BLVD Location #`) != ''
GROUP BY num
```

- Returns `null` when `runQuery` fails (consistent with `listLocationNames`).
- **No `unstable_cache`**: called only from sync/confirm paths; a stale coords
  map must never poison a sync (cf. the 24 h empty-cache incident).
- Pure row→Map converter exported for tests; coerces BIGNUMERIC via the
  existing `toNumber` handling and drops non-finite values.

### 2. Owner dots (`syncOwnerLocations`)

- Fetch the coords map alongside the directory (`Promise.all` with the
  existing fetches). If it is `null`, log and proceed — sync must not block
  on the coords source; rows behave as "not covered".
- In the per-row `values` build: when the incoming row's
  `blvd_location_number` (trimmed) hits the coords map, set
  `latitude`/`longitude` from Monday, `geocodedAt = now`,
  `coordSource = 'monday'` — **unconditionally**, replacing the
  preserve-prior-coords logic for covered rows.
- Uncovered rows keep exactly today's behavior: preserve prior coords, and the
  existing MapTiler backfill loop fills NULL-latitude rows
  (`coordSource = 'maptiler'` when it succeeds).
- `SyncResult` gains `mondayCoordsApplied: number` and
  `listingCoordsApplied: number` (surfaced in the admin sync result and cron
  log like existing counters).

### 3. Listing pins (same sync, after the owner upsert)

- One SQL `UPDATE ... FROM` (or equivalent Drizzle) over salon-type
  `listing_locations` with `dataMappingStatus = 'confirmed'` and non-null
  `bqLocationName`: join `owner_locations.resolvedBqLocationName =
  bqLocationName` to obtain `blvdLocationNumber`, then apply the Monday
  coords for that number; set `geocodeSource = 'monday'`,
  `geocodedAt = now`. Multi-owner rows sharing a `resolvedBqLocationName`
  carry the same location number, so any matching row works (pick
  deterministically, e.g. max non-null number).
- Best-effort like the geocode backfill: failure logs and never aborts the
  sync (directory upsert already committed).

### 4. Confirm-mapping hook (`src/lib/data/mapping-actions.ts`)

When an admin confirms a mapping (`status = 'confirmed'` with a
`bqLocationName`), resolve that name → owner row → number → Monday coords
(single coords-map fetch) and include `latitude`/`longitude`/`geocodeSource`/
`geocodedAt` in the same `UPDATE` when found. Coords fetch failure degrades to
today's behavior (mapping confirmed, coords unchanged until next sync).

### 5. Schema + migration

- `owner_locations.coord_source` — nullable `text`, values `'monday'` |
  `'maptiler'`. Hand-authored migration `0007_owner_locations_coord_source.sql`
  (`ALTER TABLE ... ADD COLUMN`), applied per the guarded-migrations workflow.
  No backfill of the column for existing rows: the first sync stamps every
  covered row `'monday'`, and old MapTiler rows read as NULL (unknown) until
  re-geocoded — acceptable since the column is diagnostic.
- `listing_locations` needs no schema change (`geocode_source` exists); new
  writes use `'monday'`.

### 6. Rollout

1. Merge + deploy (migration 0007 applied first).
2. Trigger one owner-directory sync (admin button) — this backfills both
   layers, including the 5 never-geocoded owner dots.
3. Verify `/browse`: dots for #045/#218/#241/#015/#259 appear; spot-check a
   few pins; confirm Royal Oak #127 moved (expected, per source-of-truth
   decision) and send the known-bad list to the data team.

## Error handling

- Coords fetch `null` → sync/confirm proceed without coords (logged).
- Per-row coords application never throws (pure map lookup).
- Listing bridge and MapTiler backfill remain best-effort post-commit steps,
  each in its own try/catch, consistent with today's sync.

## Testing

- Pure: BQ row→Map converter (dedup, empty-number exclusion, BIGNUMERIC
  coercion, non-finite drops).
- Sync: extend `owner-directory` tests — covered row gets Monday coords +
  source stamp on every sync (overwrites a differing prior), uncovered row
  preserves prior coords, coords-fetch failure leaves rows untouched and sync
  succeeding, counters correct.
- Listing bridge: confirmed+salon rows updated via the name→number bridge;
  unconfirmed/territory rows untouched.
- Confirm-mapping action: coords applied when resolvable, mapping still
  confirmed when coords fetch fails.
- All via existing vitest patterns (mocked `runQuery`/db), TDD during
  implementation.
