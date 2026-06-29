import {
  pgTable, text, timestamp, integer, boolean, primaryKey, index
} from "drizzle-orm/pg-core"

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  // Custom columns:
  role: text("role", { enum: ["user", "admin"] }).default("user").notNull(),
  sellerAccess: boolean("seller_access").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Owner directory link (Part A). Resolved from owner_locations by email at
  // login. source=manual is an admin override and must never be overwritten by
  // the automatic email match.
  ownerIdentifier: text("owner_identifier"),
  ownerLinkSource: text("owner_link_source", { enum: ["auto", "manual"] }),
}, (table) => [
  index("users_owner_identifier_idx").on(table.ownerIdentifier),
])

export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
}, (account) => ({
  compoundKey: primaryKey({ columns: [account.provider, account.providerAccountId] }),
}))

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
}, (vt) => ({
  compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
}))

export const allowlist = pgTable("allowlist", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text("email").unique().notNull(),
  addedBy: text("added_by").references(() => users.id),
  addedAt: timestamp("added_at").defaultNow().notNull(),
})
