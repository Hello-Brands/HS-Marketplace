import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

// One row per time a seller acknowledges the "Selling Your Franchise" disclaimer
// on the add-listing gate. Append-only audit log (timestamp + FDD version).
// The acknowledgment happens before any listing exists, so it ties to the user.
export const listingDisclaimerAcknowledgments = pgTable(
  "listing_disclaimer_acknowledgments",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fddVersion: text("fdd_version").notNull(),
    acknowledgedAt: timestamp("acknowledged_at").defaultNow().notNull(),
  },
  (table) => [
    index("listing_disclaimer_ack_user_id_idx").on(table.userId),
  ],
)

export const listingDisclaimerAcknowledgmentsRelations = relations(
  listingDisclaimerAcknowledgments,
  ({ one }) => ({
    user: one(users, {
      fields: [listingDisclaimerAcknowledgments.userId],
      references: [users.id],
    }),
  }),
)

export type ListingDisclaimerAcknowledgment = typeof listingDisclaimerAcknowledgments.$inferSelect
export type NewListingDisclaimerAcknowledgment = typeof listingDisclaimerAcknowledgments.$inferInsert
