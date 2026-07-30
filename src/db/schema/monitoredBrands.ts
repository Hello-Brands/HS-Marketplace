import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core"

/**
 * Brands currently monitored — OWNED AND WRITTEN by the external
 * `competitor-monitor` repo, which upserts a row when a brand's scraper goes
 * live and keeps `locations_count` fresh on its scrape runs.
 *
 * THIS APP TREATS THE TABLE AS STRICTLY READ-ONLY (same contract as
 * competitor_opportunities — see that file's header for the full rules):
 * never write to it, no foreign keys into it, and the column names/types are
 * a CONTRACT shared with the monitor repo. The app reads it only to dedupe
 * brand requests at submit time ("X is already monitored").
 */
export const monitoredBrands = pgTable("monitored_brands", {
  brandId: text("brand_id").primaryKey(), // monitor-assigned, e.g. 'ewc'
  name: text("name").notNull(),
  domain: text("domain").notNull(), // bare host, lowercase, no www — matches brand_requests.normalized_domain
  locationsCount: integer("locations_count").default(0), // null until first scrape counts them
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

export type MonitoredBrand = typeof monitoredBrands.$inferSelect
