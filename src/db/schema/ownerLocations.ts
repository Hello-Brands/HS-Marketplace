import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  doublePrecision,
} from "drizzle-orm/pg-core"

/**
 * Owner directory — one row per owner-location, mirrored from BigQuery
 * `even-affinity-388602.data_mart_for_tools.vw_monday_data_raw`
 * (full-refresh sync; see src/lib/owner-directory).
 *
 * NOTE: despite the "blvd_" prefixes there is no Boulevard numeric id in this
 * system. Financials key on the BigQuery LOCATION_NAME string, so Step-3
 * resolution matches blvd_location_name -> LOCATION_NAME and stores the result
 * in `resolvedBqLocationName` (consistent with listing_locations.bqLocationName).
 *
 * "Unknown Owner" rows are kept for admin visibility but must NEVER be linked
 * to a user.
 */
export const ownerLocations = pgTable(
  "owner_locations",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

    // --- Mirrored directly from the view ---
    ownerIdentifier: text("owner_identifier").notNull(),
    ownerName: text("owner_name"),
    ownerContactEmail: text("owner_contact_email"),
    blvdLocationName: text("blvd_location_name").notNull(),
    blvdLocationNumber: text("blvd_location_number"),
    locationAddress: text("location_address"),
    actualSuiteGoDate: timestamp("actual_suite_go_date", { mode: "date" }),
    suiteClosedDate: timestamp("suite_closed_date", { mode: "date" }),
    actualFlagshipGoDate: timestamp("actual_flagship_go_date", { mode: "date" }),
    flagshipClosedDate: timestamp("flagship_closed_date", { mode: "date" }),

    // --- Derived / resolved (preserved across syncs) ---
    // Lowercased + trimmed owner_contact_email, for login matching.
    ownerContactEmailNormalized: text("owner_contact_email_normalized"),
    // The matched BigQuery LOCATION_NAME (the financial join key). Nullable
    // until resolved in Step 3; preserved across full-refresh syncs.
    resolvedBqLocationName: text("resolved_bq_location_name"),
    blvdMatchMethod: text("blvd_match_method", {
      enum: ["number_exact", "name_exact", "name_fuzzy", "unmatched"],
    })
      .default("unmatched")
      .notNull(),
    blvdMatchConfidence: text("blvd_match_confidence", {
      enum: ["high", "medium", "low", "none"],
    })
      .default("none")
      .notNull(),

    syncedAt: timestamp("synced_at").defaultNow().notNull(),

    // Geocoded from locationAddress for the /browse map (unlisted HS dots).
    // Nullable until geocoded; preserved across full-refresh syncs.
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    geocodedAt: timestamp("geocoded_at"),
  },
  (table) => [
    // Natural key: blvd_location_number is nullable in the source, so key on
    // (owner_identifier, blvd_location_name) which are always present.
    uniqueIndex("owner_locations_owner_loc_idx").on(
      table.ownerIdentifier,
      table.blvdLocationName,
    ),
    index("owner_locations_owner_identifier_idx").on(table.ownerIdentifier),
    index("owner_locations_email_normalized_idx").on(
      table.ownerContactEmailNormalized,
    ),
    index("owner_locations_lat_lng_idx").on(table.latitude, table.longitude),
  ],
)

export type OwnerLocation = typeof ownerLocations.$inferSelect
export type NewOwnerLocation = typeof ownerLocations.$inferInsert
