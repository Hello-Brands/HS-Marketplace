import { pgTable, text, timestamp, json, integer, doublePrecision, boolean } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

export const alerts = pgTable("alerts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Optional user-set label; null = derive from filters
  name: text("name"),
  // Filter criteria
  query: text("query"), // free text; saved for re-apply, NOT matched
  states: json("states").$type<string[]>(),
  listingTypes: json("listing_types").$type<string[]>(),
  // Price range (in cents)
  minPrice: integer("min_price"),
  maxPrice: integer("max_price"),
  minYearsOpen: integer("min_years_open"),
  sort: text("sort"), // saved for re-apply, NOT matched
  // Location / radius
  centerLat: doublePrecision("center_lat"),
  centerLng: doublePrecision("center_lng"),
  radiusMiles: integer("radius_miles"),
  centerLabel: text("center_label"),
  // Per-search email toggle
  notifyEnabled: boolean("notify_enabled").default(true).notNull(),
  // Layer toggles captured from the browse filter bar; gate which alerts fire.
  includeListings: boolean("include_listings").default(true).notNull(),
  includeCompetitors: boolean("include_competitors").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull().$onUpdate(() => new Date()),
})

export const alertsRelations = relations(alerts, ({ one }) => ({
  user: one(users, {
    fields: [alerts.userId],
    references: [users.id],
  }),
}))

export type Alert = typeof alerts.$inferSelect
export type NewAlert = typeof alerts.$inferInsert
