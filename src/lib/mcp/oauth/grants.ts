/**
 * Read and revoke MCP connections.
 *
 * This module is deliberately NOT a `"use server"` file. Every export of such a
 * module is a public POST endpoint, and `revokeMcpToken` takes a trusted
 * `AdminActor` rather than reading the session — exposing it directly would
 * let anyone pass someone else's id and revoke their connection. The session
 * is resolved by the thin `"use server"` wrapper in
 * src/app/admin/mcp-connections/actions.ts, and by the bearer actor in PR C.
 *
 * Keep it that way: do not add `"use server"` to this file.
 */
import { desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { mcpOauthClients, mcpOauthTokens } from "@/db/schema/mcpOauth"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "@/lib/admin/core/actor"

/** One grant, as the admin table and the MCP list tool render it. */
export interface McpConnectionRow {
  id: string
  userId: string
  userEmail: string | null
  clientId: string
  clientName: string
  scope: string
  label: string | null
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
  refreshExpiresAt: Date
  revokedAt: Date | null
}

/**
 * Grants for one admin, or for every admin when `all` is true.
 *
 * Revoked and expired rows are INCLUDED: the table shows status, and hiding a
 * revocation would make "did that actually take effect?" unanswerable. Reads
 * are not audited here — only the admin UI page consumes this.
 */
export async function listMcpConnections(opts: {
  userId: string
  all: boolean
}): Promise<McpConnectionRow[]> {
  const query = db
    .select({
      id: mcpOauthTokens.id,
      userId: mcpOauthTokens.userId,
      userEmail: users.email,
      clientId: mcpOauthTokens.clientId,
      clientName: mcpOauthClients.name,
      scope: mcpOauthTokens.scope,
      label: mcpOauthTokens.label,
      createdAt: mcpOauthTokens.createdAt,
      lastUsedAt: mcpOauthTokens.lastUsedAt,
      expiresAt: mcpOauthTokens.expiresAt,
      refreshExpiresAt: mcpOauthTokens.refreshExpiresAt,
      revokedAt: mcpOauthTokens.revokedAt,
    })
    .from(mcpOauthTokens)
    .innerJoin(users, eq(users.id, mcpOauthTokens.userId))
    .innerJoin(mcpOauthClients, eq(mcpOauthClients.clientId, mcpOauthTokens.clientId))

  const scoped = opts.all ? query : query.where(eq(mcpOauthTokens.userId, opts.userId))

  return scoped.orderBy(desc(mcpOauthTokens.createdAt))
}

/**
 * Revoke one grant.
 *
 * `ownOnly` is the difference between the two callers: the admin UI passes
 * false (an admin may revoke any admin's connection), while PR C's
 * `revoke_mcp_connection` tool passes true, so a token can only cut off itself
 * or its owner's other connections — never another admin's (spec section 7.4).
 *
 * Returns `{ ok: false, error }` rather than throwing, because Next redacts
 * thrown server-action messages in production and the admin would otherwise see
 * only "an error occurred" (same convention as `addToAllowlist`). Every core
 * mutation is called through `withAudit` (spec section 6.2).
 */
export async function revokeMcpToken(
  actor: AdminActor,
  opts: { tokenId: string; ownOnly: boolean },
): Promise<{ ok: true; auditId: string } | { ok: false; error: string; auditId: string }> {
  const { result, auditId } = await withAudit(
    actor,
    "mcp_token.revoke",
    { type: "mcp_token", id: opts.tokenId },
    { tokenId: opts.tokenId, ownOnly: opts.ownOnly },
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      const row = await db.query.mcpOauthTokens.findFirst({
        where: eq(mcpOauthTokens.id, opts.tokenId),
        columns: { id: true, userId: true, revokedAt: true },
      })

      if (!row) return { ok: false, error: "Connection not found" }

      if (opts.ownOnly && row.userId !== actor.userId) {
        // Same message as "not found" would be friendlier to enumeration, but
        // this surface is admin-only: a clear message is worth more than the
        // ambiguity.
        return { ok: false, error: "You can only revoke your own MCP connections" }
      }

      // Idempotent, and never moves an existing revocation timestamp forward.
      if (row.revokedAt) return { ok: true }

      await db
        .update(mcpOauthTokens)
        .set({ revokedAt: new Date() })
        .where(eq(mcpOauthTokens.id, row.id))

      return { ok: true }
    },
  )
  return { ...result, auditId }
}
