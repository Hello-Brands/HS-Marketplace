import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { listings } from "./listings"
import { users } from "./auth"

export const favorites = pgTable(
  "favorites",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    listingId: text("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("favorites_user_listing_idx").on(table.userId, table.listingId),
    // Detail-page favorite counts: the unique index above leads with user_id, so
    // listing-only lookups seq-scan without this (FK not auto-indexed by Postgres)
    index("favorites_listing_id_idx").on(table.listingId),
  ],
)

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, {
    fields: [favorites.userId],
    references: [users.id],
  }),
  listing: one(listings, {
    fields: [favorites.listingId],
    references: [listings.id],
  }),
}))

export type Favorite = typeof favorites.$inferSelect
export type NewFavorite = typeof favorites.$inferInsert
