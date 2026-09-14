/**
 * Admin action audit log writer.
 *
 * This module is deliberately NOT a `"use server"` file. Every export of a
 * `"use server"` module is reachable as an unauthenticated POST endpoint, and
 * this module writes rows that the activity feed and MCP treat as truth. It is
 * only ever called server-side from the core admin modules. Do not re-export
 * it from a `"use server"` module and do not add `"use server"` here.
 */
import * as Sentry from "@sentry/nextjs"
import { db } from "@/db"
import { adminAuditLog, type AuditTargetType, type NewAdminAuditLogRow } from "@/db/schema/adminAuditLog"
import type { AdminActor } from "./core/actor"

export interface AuditTarget {
  type: AuditTargetType
  id: string | null
}

const REDACT_KEYS = new Set(["message", "notes", "body"])
const MAX_STRING = 2048

/** Strip free-text fields and cap long strings before the args hit the DB. */
export function redactAuditArgs(args: unknown): unknown {
  if (args === null || args === undefined) return args
  if (typeof args === "string") {
    return args.length > MAX_STRING ? `${args.slice(0, MAX_STRING)}…[truncated]` : args
  }
  if (Array.isArray(args)) return args.map(redactAuditArgs)
  if (typeof args === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k) ? "[redacted]" : redactAuditArgs(v)
    }
    return out
  }
  return args
}

function isRejectedResult(value: unknown): value is { ok: false; error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === "string"
  )
}

async function insertRow(row: NewAdminAuditLogRow): Promise<void> {
  try {
    await db.insert(adminAuditLog).values(row)
  } catch (err) {
    // Auditing must never block or fail the action it describes.
    console.error("[audit] failed to write admin_audit_log row", row.action, err)
    Sentry.captureException(err)
  }
}

function baseRow(actor: AdminActor, action: string, target: AuditTarget | null, args: unknown) {
  return {
    actorUserId: actor.userId,
    source: actor.source,
    mcpClientId: actor.clientId ?? null,
    mcpTokenId: actor.tokenId ?? null,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    args: redactAuditArgs(args),
  }
}

/**
 * Run `fn`, then write one audit row describing it. A thrown error is logged
 * as outcome "error" and rethrown. A returned `{ ok:false, error }` is logged
 * as outcome "error" but returned normally (that is the house convention for
 * user-input failures).
 */
export async function withAudit<T>(
  actor: AdminActor,
  action: string,
  target: AuditTarget | null,
  args: unknown,
  fn: () => Promise<T>,
): Promise<{ result: T; auditId: string }> {
  const auditId = crypto.randomUUID()
  const started = Date.now()
  const base = baseRow(actor, action, target, args)
  try {
    const result = await fn()
    const rejected = isRejectedResult(result)
    await insertRow({
      id: auditId,
      ...base,
      outcome: rejected ? "error" : "ok",
      error: rejected ? result.error : null,
      durationMs: Date.now() - started,
    })
    return { result, auditId }
  } catch (err) {
    await insertRow({
      id: auditId,
      ...base,
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    })
    throw err
  }
}

/** Lighter row for MCP read tools so an AI session's reads are visible. */
export async function recordMcpRead(actor: AdminActor, tool: string, args: unknown): Promise<string> {
  const auditId = crypto.randomUUID()
  await insertRow({
    id: auditId,
    ...baseRow(actor, "mcp.read", null, { tool, filters: args }),
    outcome: "ok",
    error: null,
    durationMs: 0,
  })
  return auditId
}
