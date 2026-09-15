import { pgTable, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { users } from "./auth"

/**
 * One row per admin mutation, whether it came from the web UI or the MCP
 * server. Written by `withAudit` in src/lib/admin/audit.ts — never insert
 * into this table directly. Reads are audited only when they come through
 * the MCP (`action = 'mcp.read'`).
 */
export const AUDIT_SOURCES = ["ui", "mcp"] as const
export type AuditSource = (typeof AUDIT_SOURCES)[number]

export const AUDIT_OUTCOMES = ["ok", "error"] as const
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

export const AUDIT_TARGET_TYPES = [
  "listing",
  "user",
  "allowlist",
  "brand_request",
  "owner_link",
  "listing_location",
  "owner_directory",
  "mcp_token",
] as const
export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number]

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    // Null after the acting admin is deleted; the row itself is kept.
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source", { enum: AUDIT_SOURCES }).notNull(),
    mcpClientId: text("mcp_client_id"),
    mcpTokenId: text("mcp_token_id"),
    // Dotted verb, e.g. "listing.approve". See the Global Constraints list in
    // the PR A plan for the full set.
    action: text("action").notNull(),
    targetType: text("target_type", { enum: AUDIT_TARGET_TYPES }),
    targetId: text("target_id"),
    // Redacted by redactAuditArgs before insert.
    args: jsonb("args").$type<unknown>(),
    outcome: text("outcome", { enum: AUDIT_OUTCOMES }).notNull(),
    error: text("error"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("admin_audit_log_created_at_idx").on(table.createdAt.desc()),
    index("admin_audit_log_target_idx").on(table.targetType, table.targetId),
    index("admin_audit_log_actor_created_at_idx").on(table.actorUserId, table.createdAt.desc()),
  ],
)

export const adminAuditLogRelations = relations(adminAuditLog, ({ one }) => ({
  actor: one(users, { fields: [adminAuditLog.actorUserId], references: [users.id] }),
}))

export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect
export type NewAdminAuditLogRow = typeof adminAuditLog.$inferInsert
