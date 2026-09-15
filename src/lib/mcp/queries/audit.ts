// Filterable, keyset-paged read of admin_audit_log for the MCP `list_audit_log` tool.
//
// NOT a use server module.
//
// Keyset, not offset: the table only ever grows at the head, so an offset page 2
// would silently skip rows written between the two calls. The cursor is
// (created_at, id) — id breaks ties within the same millisecond.
import { and, desc, eq, gte, lt, ne, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { adminAuditLog, type AuditTargetType } from "@/db/schema/adminAuditLog"
import { users } from "@/db/schema/auth"
import { encodeCursor, decodeCursor } from "@/lib/mcp/tools/_shared"

export interface AuditLogEntry {
  id: string
  /** ISO 8601. */
  at: string
  action: string
  source: string
  actor: { id: string | null; name: string | null; email: string | null }
  client_id: string | null
  target: { type: string | null; id: string | null }
  outcome: string
  error: string | null
  duration_ms: number | null
  args: unknown
}

export interface AuditLogFilters {
  actorUserId?: string
  action?: string
  targetType?: string
  targetId?: string
  source?: "ui" | "mcp"
  since?: Date
  /**
   * `mcp.read` rows are excluded by default: an MCP session writes one per read,
   * so leaving them in would bury the mutations an admin is actually looking for.
   */
  includeReads?: boolean
  limit: number
  cursor?: string
}

export async function listAuditLog(
  filters: AuditLogFilters,
): Promise<{ items: AuditLogEntry[]; next_cursor: string | null }> {
  const conditions: SQL[] = []

  if (!filters.includeReads) conditions.push(ne(adminAuditLog.action, "mcp.read"))
  if (filters.actorUserId) conditions.push(eq(adminAuditLog.actorUserId, filters.actorUserId))
  if (filters.action) conditions.push(eq(adminAuditLog.action, filters.action))
  // The column is an enum-typed text; the filter is a free string so an unknown
  // target type simply matches no rows instead of failing to compile.
  if (filters.targetType)
    conditions.push(eq(adminAuditLog.targetType, filters.targetType as AuditTargetType))
  if (filters.targetId) conditions.push(eq(adminAuditLog.targetId, filters.targetId))
  if (filters.source) conditions.push(eq(adminAuditLog.source, filters.source))
  if (filters.since) conditions.push(gte(adminAuditLog.createdAt, filters.since))

  const cursor = decodeCursor(filters.cursor)
  if (cursor && typeof cursor.at === "string" && typeof cursor.id === "string") {
    const at = new Date(cursor.at)
    if (!Number.isNaN(at.getTime())) {
      const keyset = or(
        lt(adminAuditLog.createdAt, at),
        and(eq(adminAuditLog.createdAt, at), lt(adminAuditLog.id, cursor.id)),
      )
      if (keyset) conditions.push(keyset)
    }
  }

  // Fetch one extra row: its presence is how we know another page exists without
  // paying for a second COUNT query.
  const rows = await db
    .select({
      id: adminAuditLog.id,
      createdAt: adminAuditLog.createdAt,
      action: adminAuditLog.action,
      source: adminAuditLog.source,
      mcpClientId: adminAuditLog.mcpClientId,
      actorUserId: adminAuditLog.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      outcome: adminAuditLog.outcome,
      error: adminAuditLog.error,
      durationMs: adminAuditLog.durationMs,
      args: adminAuditLog.args,
    })
    .from(adminAuditLog)
    .leftJoin(users, eq(users.id, adminAuditLog.actorUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
    .limit(filters.limit + 1)

  const hasMore = rows.length > filters.limit
  const page = hasMore ? rows.slice(0, filters.limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      action: r.action,
      source: r.source,
      actor: { id: r.actorUserId, name: r.actorName, email: r.actorEmail },
      client_id: r.mcpClientId,
      target: { type: r.targetType, id: r.targetId },
      outcome: r.outcome,
      error: r.error,
      duration_ms: r.durationMs,
      args: r.args,
    })),
    next_cursor:
      hasMore && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null,
  }
}
