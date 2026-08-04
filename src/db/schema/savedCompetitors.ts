import { pgTable, text, varchar, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

/**
 * A user's saved competitor locations. App-owned (the user creates these).
 *
 * Stores a SNAPSHOT of the competitor's display fields rather than referencing
 * `competitor_opportunities`: that table is scraper-owned and fully reconciled
 * each run (rows come and go), so a foreign key would delete a user's saves
 * whenever the scraper churns. `placeId` keeps the link to the source row's
 * stable Google place id without enforcing referential integrity.
 */
export const savedCompetitors = pgTable(
  "saved_competitors",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    placeId: text("place_id").notNull(), // Google place id of the saved competitor
    // Snapshot of display fields (see header for why we snapshot).
    brandName: text("brand_name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    lat: numeric("lat", { precision: 10, scale: 7 }).notNull(),
    lng: numeric("lng", { precision: 10, scale: 7 }).notNull(),
    businessStatus: text("business_status").notNull(),
    mapsUrl: text("maps_url"),
    // Detection timestamp snapshotted from competitor_opportunities.closed_at.
    // timestamptz (unlike created_at below) so the source instant survives.
    // Captured at save time and intentionally not refreshed afterward — staleness
    // vs. foreign-key deletion is the correct tradeoff for user-owned data.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("saved_competitors_user_place_idx").on(table.userId, table.placeId),
  ],
)

export const savedCompetitorsRelations = relations(savedCompetitors, ({ one }) => ({
  user: one(users, {
    fields: [savedCompetitors.userId],
    references: [users.id],
  }),
}))

export type SavedCompetitor = typeof savedCompetitors.$inferSelect
export type NewSavedCompetitor = typeof savedCompetitors.$inferInsert
