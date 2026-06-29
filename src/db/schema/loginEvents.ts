import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

// One row per successful login. Source of truth for the 30-day login trend
// chart and "active this week". users.loginCount / lastLoginAt are denormalized
// conveniences written alongside.
export const loginEvents = pgTable(
  "login_events",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("login_events_created_at_idx").on(table.createdAt),
    index("login_events_user_id_idx").on(table.userId),
  ],
)

export const loginEventsRelations = relations(loginEvents, ({ one }) => ({
  user: one(users, { fields: [loginEvents.userId], references: [users.id] }),
}))

export type LoginEvent = typeof loginEvents.$inferSelect
export type NewLoginEvent = typeof loginEvents.$inferInsert
