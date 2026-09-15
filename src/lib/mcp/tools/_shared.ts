// Shared toolkit for every MCP tool module.
//
// NOT a use server module. Every "use server" export is a public POST endpoint;
// these are plain functions imported by the MCP tool modules, which are reached
// only through the bearer-verified POST /api/mcp route handler.
//
// Deliberately NOT marked `import "server-only"`: tsx scripts crash on any
// transitive server-only import and vitest stubs it, so the guard would buy
// nothing here and could break a future script.
import { z } from "zod"
import * as Sentry from "@sentry/nextjs"
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server"
import type { AdminActor } from "@/lib/admin/core/actor"
import { recordMcpRead } from "@/lib/admin/audit"
import type { McpActor } from "@/lib/mcp/auth/verify-token"
import { checkRateLimit } from "@/lib/rate-limit"
import { formatUsdCents } from "@/lib/money"

/** Per-request identity threaded into every tool handler. */
export interface McpToolContext {
  /** The audit-log actor. Always `source: "mcp"`. */
  actor: AdminActor
  /** The verified token, kept for rate-limit keying and the connection tools. */
  mcp: McpActor
  /** Whether the token carries `marketplace:write`. Gates write-tool registration. */
  canWrite: boolean
}

export function toolContext(mcp: McpActor): McpToolContext {
  return {
    actor: { userId: mcp.userId, source: "mcp", clientId: mcp.clientId, tokenId: mcp.tokenId },
    mcp,
    canWrite: mcp.scopes.includes("marketplace:write"),
  }
}

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100
export const WRITE_LIMIT_PER_MINUTE = 30
const WRITE_WINDOW_MS = 60_000

/** Shared zod fragments so every tool spells the same constraint the same way. */
export const limitField = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .optional()
  .describe(`Maximum items to return (1-${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`)

export const cursorField = z
  .string()
  .max(512)
  .optional()
  .describe("Opaque pagination cursor from a previous call's next_cursor. Omit for the first page.")

export const searchField = z
  .string()
  .max(200)
  .optional()
  .describe("Case-insensitive substring filter (max 200 characters).")

export const reasonField = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .describe("Reason shown to the affected user (max 2000 characters).")

export const notesField = z
  .string()
  .max(2000)
  .optional()
  .describe("Optional internal note appended to the reason (max 2000 characters).")

export const confirmationField = z
  .string()
  .max(4096)
  .optional()
  .describe(
    "Token from this tool's own preview response. Omit on the first call to receive a preview and a token; " +
      "pass it back UNCHANGED, with identical arguments, to execute.",
  )

/** Opaque, URL-safe cursor. Opaque on purpose: the shape is ours to change. */
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

/**
 * Decode a cursor, or null when it is absent or unusable. Never throws: a client
 * that replays a stale or hand-edited cursor gets page one, not a 500.
 */
export function decodeCursor(cursor: string | undefined): Record<string, unknown> | null {
  if (!cursor) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Offset pagination over an already-materialized array. Used by the tools whose
 * source (a PR A core read) returns the whole set in one query — those reads are
 * the same ones the admin pages already run, so paging in memory is honest here.
 * DB-backed lists (audit log, activity, brand requests) use keyset cursors instead.
 */
export function paginateArray<T>(
  rows: T[],
  limit: number | undefined,
  cursor: string | undefined,
): { items: T[]; next_cursor: string | null } {
  const size = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const decoded = decodeCursor(cursor)
  const rawOffset = decoded && typeof decoded.o === "number" ? decoded.o : 0
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0
  const items = rows.slice(offset, offset + size)
  const nextOffset = offset + items.length
  return {
    items,
    next_cursor: nextOffset < rows.length ? encodeCursor({ o: nextOffset }) : null,
  }
}

/**
 * Every money field on the wire. Cents is the stored unit (see src/lib/money.ts);
 * `formatted` exists so the model never has to divide by 100 and get it wrong.
 */
export function money(
  cents: number | null | undefined,
): { cents: number; formatted: string } | null {
  if (cents === null || cents === undefined) return null
  return { cents, formatted: formatUsdCents(cents) }
}

/** Success: compact JSON in one text block, plus the same object as structuredContent. */
export function toolResult(structured: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  }
}

/**
 * Failure the model can act on: an in-band `isError` result (NOT a JSON-RPC error),
 * carrying exactly the sentence the admin UI would have shown.
 */
export function toolError(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  }
}

/**
 * Whether a caught value is one of OUR refusals rather than a bug.
 *
 * Every PR A core mutation signals a refusal by throwing a plain `new Error(msg)`
 * carrying the same copy the UI shows. Driver and runtime failures throw Error
 * SUBCLASSES (`NeonDbError`, `TypeError`, `ZodError`), which set their own `name`.
 * That distinction is the whole rule — it keeps internal failures out of the
 * model's context while letting "Cannot demote the last admin" straight through.
 */
export function isExpectedToolError(err: unknown): err is Error {
  return err instanceof Error && err.name === "Error"
}

function mapThrown(tool: string, err: unknown): CallToolResult {
  if (isExpectedToolError(err)) return toolError(err.message)
  const ref = crypto.randomUUID()
  Sentry.captureException(err, { tags: { mcp_ref: ref, mcp_tool: tool } })
  return toolError(`Unexpected error (ref ${ref})`)
}

/**
 * Wrapper for every read tool: write the `mcp.read` audit row, run the read, shape
 * the result, map failures.
 *
 * The audit write is awaited but never fatal — auditing must not be able to take
 * the endpoint down (the same rule PR A applies inside `withAudit`).
 */
export async function readTool(
  ctx: McpToolContext,
  tool: string,
  args: Record<string, unknown>,
  run: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    await recordMcpRead(ctx.actor, tool, args).catch((err: unknown) => {
      Sentry.captureException(err, { tags: { mcp_tool: tool, mcp_stage: "read_audit" } })
    })
    return toolResult(await run())
  } catch (err) {
    return mapThrown(tool, err)
  }
}

/**
 * Wrapper for every write tool: per-token rate limit, run, shape, map failures.
 *
 * No `recordMcpRead` here — the PR A core function the write delegates to already
 * writes its own audit row through `withAudit` and hands back the id.
 *
 * The limiter is per-instance and in-memory (DEBT-028), so this throttles a hot
 * loop hitting one warm Vercel instance. It is a mitigation, not a guarantee.
 */
export async function writeTool(
  ctx: McpToolContext,
  tool: string,
  args: Record<string, unknown>,
  run: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  const limit = checkRateLimit(
    `mcp-write:${ctx.mcp.tokenId}`,
    WRITE_LIMIT_PER_MINUTE,
    WRITE_WINDOW_MS,
  )
  if (!limit.allowed) {
    const seconds = Math.ceil((limit.retryAfterMs ?? WRITE_WINDOW_MS) / 1000)
    return toolError(
      `Too many write operations on this connection (limit ${WRITE_LIMIT_PER_MINUTE} per minute). Retry in ${seconds}s.`,
    )
  }
  try {
    return toolResult(await run())
  } catch (err) {
    return mapThrown(tool, err)
  }
}

export const READ_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/** Non-destructive write: changes state, but nothing is lost or irreversible. */
export const WRITE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

/** Destructive write. Pair with REQUIRES_USER_INTERACTION and a confirmation token. */
export const DESTRUCTIVE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
}

/**
 * Tool `_meta` that makes Claude.ai prompt per call and Claude Code prompt even in
 * auto-accept modes. Verified to reach the wire: McpServer's tools/list handler
 * copies `_meta` straight onto the advertised tool.
 */
export const REQUIRES_USER_INTERACTION = { "anthropic/requiresUserInteraction": true } as const

/** The `target` for a write whose row is gone afterwards. */
export function deletedTarget(type: string, id: string): Record<string, unknown> {
  return { type, id, deleted: true }
}
