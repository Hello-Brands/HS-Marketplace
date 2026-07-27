import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"
import { users } from "./auth"

/**
 * A user's link to an owner_identifier. Replaces the old scalar
 * users.owner_identifier / users.owner_link_source pair so one user can hold
 * several owner profiles (real owners appear in the directory under one
 * identifier per co-ownership grouping).
 *
 *   auto    - derived from the directory email match; re-reconciled every login
 *   manual  - added by an admin; the auto matcher never overwrites it
 *   revoked - admin suppression; the auto matcher must skip this owner
 *
 * EFFECTIVE links are source IN ('auto','manual'). One row per (user, owner)
 * so "linked and revoked at once" is unrepresentable.
 *
 * owner_identifier is a SOFT reference, not an FK: owner_locations has no
 * unique constraint on owner_identifier alone (its unique index is
 * (owner_identifier, blvd_location_name)) and the sync full-refreshes rows.
 * A link can therefore outlive its directory rows — surface that in admin UI
 * rather than assuming it cannot happen.
 */
export const OWNER_LINK_SOURCES = ["auto", "manual", "revoked"] as const
export type OwnerLinkSource = (typeof OWNER_LINK_SOURCES)[number]

export const userOwnerLinks = pgTable(
  "user_owner_links",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ownerIdentifier: text("owner_identifier").notNull(),
    source: text("source", { enum: OWNER_LINK_SOURCES }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    // The admin who added or revoked; null for auto links.
    actorUserId: text("actor_user_id").references(() => users.id),
  },
  (table) => [
    uniqueIndex("user_owner_links_user_owner_idx").on(
      table.userId,
      table.ownerIdentifier,
    ),
    index("user_owner_links_user_idx").on(table.userId),
  ],
)

export type UserOwnerLink = typeof userOwnerLinks.$inferSelect
export type NewUserOwnerLink = typeof userOwnerLinks.$inferInsert
