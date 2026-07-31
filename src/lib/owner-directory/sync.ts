import "server-only"
import { inArray, sql, isNull, eq } from "drizzle-orm"
import { db } from "@/db"
import { ownerLocations } from "@/db/schema"
import { listLocationNames, getMondayCoordsByLocationNumber } from "@/lib/bigquery/queries"
import { fetchOwnerDirectory, parseBqDate, type DirectoryRow } from "./query"
import { resolveOwnerRowCoords, applyMondayCoordsToListings } from "./monday-coords"
import { resolveBlvdLocationName, type BlvdMatchMethod } from "./resolve"
import { normalizeEmail } from "./email"
import { geocodeAddress } from "@/lib/geocode/geocode"
import { env } from "@/lib/env"

export type SyncResult = {
  fetched: number
  duplicatesDropped: number
  upserted: number
  deletedStale: number
  preserved: number
  geocoded: number
  mondayCoordsApplied: number
  listingCoordsApplied: number
  byMethod: Record<BlvdMatchMethod, number>
  bqNamesAvailable: boolean
}

const keyOf = (ownerIdentifier: string, blvdLocationName: string) =>
  `${ownerIdentifier} ${blvdLocationName}`

/**
 * Full-refresh the owner_locations mirror from BigQuery.
 *
 *  - Dedupes incoming rows on the natural key (owner_identifier,
 *    blvd_location_name) so a duplicate row never crashes the upsert.
 *  - Preserves already-resolved mapping columns for rows that still exist;
 *    (re)resolves only new or still-unmatched rows.
 *  - Upserts every row and deletes rows no longer in the directory, atomically
 *    (single neon-http batch = one transaction).
 *  - Treats the Monday view's lat/lng as authoritative: every covered
 *    blvd_location_number gets Monday's coords stamped on every sync.
 *
 * Throws if BigQuery is unreachable, so the caller can surface a clear error
 * rather than silently truncating the table.
 */
export async function syncOwnerLocations(): Promise<SyncResult> {
  const [rows, bqNames, mondayCoords] = await Promise.all([
    fetchOwnerDirectory(),
    listLocationNames(),
    getMondayCoordsByLocationNumber(),
  ])
  if (rows === null) {
    throw new Error(
      "owner-directory sync: BigQuery returned no result (check GCP_SERVICE_ACCOUNT_JSON / BIGQUERY_PROJECT_ID / view permissions)"
    )
  }
  if (mondayCoords === null) {
    // Sync must not block on the coords source; rows behave as "not covered".
    console.warn("owner-directory sync: Monday coords unavailable — coords not applied this run")
  }
  const bqNamesList = bqNames ?? []

  // Dedupe incoming by natural key (keep first; ON CONFLICT cannot touch a row twice).
  const byKey = new Map<string, DirectoryRow>()
  let duplicatesDropped = 0
  for (const r of rows) {
    const k = keyOf(r.owner_identifier, r.blvd_location_name)
    if (byKey.has(k)) {
      duplicatesDropped++
      continue
    }
    byKey.set(k, r)
  }
  const deduped = [...byKey.values()]

  // Existing resolutions to preserve.
  const existing = await db
    .select({
      id: ownerLocations.id,
      ownerIdentifier: ownerLocations.ownerIdentifier,
      blvdLocationName: ownerLocations.blvdLocationName,
      resolvedBqLocationName: ownerLocations.resolvedBqLocationName,
      blvdMatchMethod: ownerLocations.blvdMatchMethod,
      blvdMatchConfidence: ownerLocations.blvdMatchConfidence,
      latitude: ownerLocations.latitude,
      longitude: ownerLocations.longitude,
      geocodedAt: ownerLocations.geocodedAt,
      coordSource: ownerLocations.coordSource,
    })
    .from(ownerLocations)
  const existingByKey = new Map(
    existing.map((e) => [keyOf(e.ownerIdentifier, e.blvdLocationName), e])
  )

  const now = new Date()
  let preserved = 0
  const byMethod: Record<BlvdMatchMethod, number> = {
    number_exact: 0,
    name_exact: 0,
    name_fuzzy: 0,
    unmatched: 0,
  }

  let mondayCoordsApplied = 0

  const values = deduped.map((r) => {
    const prior = existingByKey.get(keyOf(r.owner_identifier, r.blvd_location_name))
    let resolvedBqLocationName: string | null
    let method: BlvdMatchMethod
    let confidence: "high" | "medium" | "low" | "none"

    if (prior && prior.resolvedBqLocationName) {
      // Preserve already-resolved work across refreshes.
      resolvedBqLocationName = prior.resolvedBqLocationName
      method = prior.blvdMatchMethod
      confidence = prior.blvdMatchConfidence
      preserved++
    } else {
      const res = resolveBlvdLocationName(r.blvd_location_name, bqNamesList)
      resolvedBqLocationName = res.resolvedBqLocationName
      method = res.method
      confidence = res.confidence
    }
    byMethod[method]++

    // Monday view coords are the source of truth (stamped every sync);
    // uncovered rows preserve prior coords like resolvedBqLocationName.
    const coordFields = resolveOwnerRowCoords(
      r.blvd_location_number || null,
      prior ?? null,
      mondayCoords,
      now
    )
    // Count only coords stamped THIS run. The identity check is exact: the
    // resolver returns this sync's `now` instance solely on a Monday hit, while
    // a preserved prior geocodedAt is always a different Date instance (even if
    // it happens to carry an equal time). Testing coordSource === "monday"
    // instead would over-count rows covered on a previous run but not this one —
    // and would report the full historical count when mondayCoords is null.
    if (coordFields.geocodedAt === now) mondayCoordsApplied++

    return {
      ownerIdentifier: r.owner_identifier,
      ownerName: r.owner_name,
      ownerContactEmail: r.owner_contact_email,
      blvdLocationName: r.blvd_location_name,
      blvdLocationNumber: r.blvd_location_number || null,
      locationAddress: r.location_address,
      actualSuiteGoDate: parseBqDate(r.actual_suite_go_date),
      suiteClosedDate: parseBqDate(r.suite_closed_date),
      actualFlagshipGoDate: parseBqDate(r.actual_flagship_go_date),
      flagshipClosedDate: parseBqDate(r.flagship_closed_date),
      ownerContactEmailNormalized: normalizeEmail(r.owner_contact_email),
      resolvedBqLocationName,
      blvdMatchMethod: method,
      blvdMatchConfidence: confidence,
      syncedAt: now,
      ...coordFields,
    }
  })

  // Stale = existing rows whose key is no longer in the directory.
  const incomingKeys = new Set(
    deduped.map((r) => keyOf(r.owner_identifier, r.blvd_location_name))
  )
  const staleIds = existing
    .filter((e) => !incomingKeys.has(keyOf(e.ownerIdentifier, e.blvdLocationName)))
    .map((e) => e.id)

  const upsert =
    values.length > 0
      ? db
          .insert(ownerLocations)
          .values(values)
          .onConflictDoUpdate({
            target: [ownerLocations.ownerIdentifier, ownerLocations.blvdLocationName],
            set: {
              ownerName: sql`excluded.owner_name`,
              ownerContactEmail: sql`excluded.owner_contact_email`,
              blvdLocationNumber: sql`excluded.blvd_location_number`,
              locationAddress: sql`excluded.location_address`,
              actualSuiteGoDate: sql`excluded.actual_suite_go_date`,
              suiteClosedDate: sql`excluded.suite_closed_date`,
              actualFlagshipGoDate: sql`excluded.actual_flagship_go_date`,
              flagshipClosedDate: sql`excluded.flagship_closed_date`,
              ownerContactEmailNormalized: sql`excluded.owner_contact_email_normalized`,
              resolvedBqLocationName: sql`excluded.resolved_bq_location_name`,
              blvdMatchMethod: sql`excluded.blvd_match_method`,
              blvdMatchConfidence: sql`excluded.blvd_match_confidence`,
              syncedAt: sql`excluded.synced_at`,
              latitude: sql`excluded.latitude`,
              longitude: sql`excluded.longitude`,
              geocodedAt: sql`excluded.geocoded_at`,
              coordSource: sql`excluded.coord_source`,
            },
          })
      : null

  const del =
    staleIds.length > 0
      ? db.delete(ownerLocations).where(inArray(ownerLocations.id, staleIds))
      : null

  // Atomic: one neon-http batch runs as a single transaction.
  if (upsert && del) await db.batch([upsert, del])
  else if (upsert) await db.batch([upsert])
  else if (del) await db.batch([del])

  // Bridge Monday coords onto confirmed listing locations. Best-effort like
  // the geocode backfill: the directory upsert above is already committed.
  let listingCoordsApplied = 0
  if (mondayCoords) {
    try {
      listingCoordsApplied = await applyMondayCoordsToListings(mondayCoords, now)
    } catch (err) {
      console.error(
        "owner-directory sync: listing coords bridge failed (directory sync already committed)",
        err
      )
    }
  }

  // Best-effort geocode of rows still missing coords (new locations, or rows
  // that failed a prior geocode). Rows covered by the Monday view are re-stamped
  // from Monday on every sync, so this only ever reaches rows Monday does not
  // cover — and those preserve their prior coords across the full-refresh, so an
  // uncovered row whose address later changes keeps its old coords until manually
  // cleared (re-geocode-on-address-change is a possible follow-up).
  // Never blocks the sync; silent when no MapTiler key.
  let geocoded = 0
  if (env.MAPTILER_API_KEY) {
    try {
      const missing = await db
        .select({ id: ownerLocations.id, locationAddress: ownerLocations.locationAddress })
        .from(ownerLocations)
        .where(isNull(ownerLocations.latitude))
      for (const m of missing) {
        if (!m.locationAddress) continue
        try {
          const geo = await geocodeAddress(m.locationAddress)
          if (!geo) continue
          await db
            .update(ownerLocations)
            .set({ latitude: geo.lat, longitude: geo.lng, geocodedAt: new Date(), coordSource: "maptiler" })
            .where(eq(ownerLocations.id, m.id))
          geocoded++
        } catch (err) {
          console.error(
            `owner-directory sync: geocode backfill failed for location ${m.id} (directory sync already committed)`,
            err,
          )
          continue
        }
      }
    } catch (err) {
      console.error(
        "owner-directory sync: geocode backfill step failed (directory sync already committed)",
        err,
      )
    }
  }

  return {
    fetched: rows.length,
    duplicatesDropped,
    upserted: values.length,
    deletedStale: staleIds.length,
    preserved,
    geocoded,
    mondayCoordsApplied,
    listingCoordsApplied,
    byMethod,
    bqNamesAvailable: bqNames !== null,
  }
}
