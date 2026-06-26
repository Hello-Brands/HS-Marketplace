import {
  pgTable,
  text,
  varchar,
  numeric,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core"

/**
 * Competitor closures — OWNED AND WRITTEN by the external `competitor-monitor`
 * scraper (hosted on Railway). It pushes the current set of closed competitor
 * salons into this database one-way on a weekly/monthly cron: it UPSERTs rows
 * by `google_place_id` and DELETES rows for competitors that have reopened
 * (a full reconcile each run).
 *
 * THIS APP TREATS THE TABLE AS STRICTLY READ-ONLY:
 *   - Never INSERT / UPDATE / DELETE from app code.
 *   - No foreign keys INTO this table — its rows come and go.
 *   - The column names and types below are a CONTRACT shared byte-for-byte with
 *     the scraper. This Drizzle definition exists ONLY so reads are type-safe.
 *     Do NOT "tidy" the names/types to match app conventions, and do NOT let a
 *     future `drizzle-kit generate` ALTER them out from under the scraper —
 *     change the contract on BOTH sides or not at all.
 *
 * Note the deliberate deviations from the rest of the schema, required by the
 * contract: `timestamptz` (the app's own tables use bare `timestamp`),
 * `varchar(2)` for state, and `numeric` lat/lng (returned as strings by the
 * driver — callers coerce with Number()).
 */
export const competitorOpportunities = pgTable(
  "competitor_opportunities",
  {
    googlePlaceId: text("google_place_id").primaryKey(), // stable natural key
    brandId: text("brand_id").notNull(), // e.g. 'ewc', 'sugaring'
    brandName: text("brand_name").notNull(), // e.g. 'European Wax Center'
    address: text("address").notNull(),
    city: text("city").notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
    lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
    businessStatus: text("business_status").notNull(), // 'CLOSED_PERMANENTLY' | 'CLOSED_TEMPORARILY'
    closedAt: timestamp("closed_at", { withTimezone: true }), // when first detected closed
    nearestHsName: text("nearest_hs_name"), // nearest Hello Sugar salon
    nearestHsMiles: numeric("nearest_hs_miles", { precision: 6, scale: 2 }), // distance to it, miles
    isOpportunity: boolean("is_opportunity").default(false).notNull(), // surface prominently
    mapsUrl: text("maps_url"), // Google Maps deep link
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("competitor_opportunities_geo_idx").on(table.lat, table.lng),
  ],
)

export type CompetitorOpportunity = typeof competitorOpportunities.$inferSelect
