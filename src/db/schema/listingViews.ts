import { pgTable, text, timestamp, date, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { listings } from "./listings"
import { users } from "./auth"

// One row per (listing, viewer, calendar day) — powers the "unique per day"
// public view metric. viewDate is date-only (string mode, UTC "YYYY-MM-DD")
// so refreshes within a day collapse to a single row.
export const listingViews = pgTable(
  "listing_views",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
    viewerId: text("viewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    viewDate: date("view_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("listing_views_listing_viewer_date_idx").on(
      table.listingId, table.viewerId, table.viewDate,
    ),
  ],
)

export const listingViewsRelations = relations(listingViews, ({ one }) => ({
  listing: one(listings, { fields: [listingViews.listingId], references: [listings.id] }),
  viewer: one(users, { fields: [listingViews.viewerId], references: [users.id] }),
}))

export type ListingView = typeof listingViews.$inferSelect
export type NewListingView = typeof listingViews.$inferInsert
