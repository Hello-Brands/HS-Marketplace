/**
 * Bearer verification for every MCP request (spec section 4.3).
 *
 * This module is deliberately NOT a `"use server"` file. Every export of such a
 * module is reachable as an unauthenticated POST endpoint, and `verifyMcpToken`
 * takes an attacker-supplied string and answers "is this a valid admin token" —
 * exposing it as an action would publish a token-validity oracle. It is only
 * ever called server-side from the MCP route.
 *
 * Keep it that way: do not re-export this from a `"use server"` module, and do
 * not add `"use server"` to this file — either would recreate the endpoint.
 */
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { mcpOauthTokens } from "@/db/schema/mcpOauth"
import { sha256Hex } from "@/lib/mcp/oauth/tokens"
import { LAST_USED_TOUCH_INTERVAL_MS } from "@/lib/mcp/oauth/constants"
import { protectedResourceMetadataUrl } from "@/lib/mcp/oauth/urls"
import { MCP_SCOPES, formatScopes, type McpScope } from "@/lib/mcp/oauth/scopes"

// Re-exported so PR C imports the scope vocabulary from the same module as the
// verifier. The definitions live in oauth/scopes.ts, which stays DB-free.
export { MCP_SCOPES, type McpScope, isMcpScope } from "@/lib/mcp/oauth/scopes"

/** Who a verified MCP request is acting as. PR C puts this on the request context. */
export interface McpActor {
  userId: string
  email: string | null
  scopes: string[]
  clientId: string
  tokenId: string
}

/** Pull the credential out of an `Authorization` header value. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim())
  const token = match?.[1]?.trim()
  return token ? token : null
}

/**
 * Resolve a bearer credential to an actor, or null.
 *
 * The `users` row is re-read on EVERY call rather than trusted from the token:
 * demoting an admin must revoke MCP access on their next request, not thirty
 * days later when the refresh token lapses.
 */
export async function verifyMcpToken(
  bearer: string | null | undefined,
): Promise<McpActor | null> {
  const token = parseBearer(bearer)
  if (!token) return null

  const rows = await db
    .select({
      id: mcpOauthTokens.id,
      clientId: mcpOauthTokens.clientId,
      userId: mcpOauthTokens.userId,
      scope: mcpOauthTokens.scope,
      expiresAt: mcpOauthTokens.expiresAt,
      revokedAt: mcpOauthTokens.revokedAt,
      lastUsedAt: mcpOauthTokens.lastUsedAt,
      email: users.email,
      role: users.role,
    })
    .from(mcpOauthTokens)
    .innerJoin(users, eq(users.id, mcpOauthTokens.userId))
    .where(eq(mcpOauthTokens.tokenHash, sha256Hex(token)))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (row.revokedAt) return null

  const now = Date.now()
  if (row.expiresAt.getTime() <= now) return null
  if (row.role !== "admin") return null

  // At most one write per minute per grant — otherwise every MCP call becomes
  // a write, for a column the UI only ever shows to the minute.
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_TOUCH_INTERVAL_MS) {
    try {
      await db
        .update(mcpOauthTokens)
        .set({ lastUsedAt: new Date(now) })
        .where(eq(mcpOauthTokens.id, row.id))
    } catch (err) {
      // Bookkeeping must never fail an authenticated request.
      console.warn("[mcp] last_used_at touch failed (non-fatal):", err)
    }
  }

  return {
    userId: row.userId,
    email: row.email,
    scopes: row.scope.split(" ").filter(Boolean),
    clientId: row.clientId,
    tokenId: row.id,
  }
}

/**
 * `WWW-Authenticate` for a 401. The `resource_metadata` pointer is what lets a
 * client discover the authorization server and start the OAuth flow by itself.
 *
 * Defaults to the FULL scope vocabulary, and that default matters: a client
 * copies this header's `scope` into its authorization request, and
 * /mcp/authorize only offers what was requested. Advertising just
 * "marketplace:read" here made claude.ai ask for read alone, so the consent
 * screen rendered a single greyed-out "Read only" row and write access was
 * unreachable through the hosted connector.
 *
 * This is not the server granting write access — the consent screen still
 * defaults to read-only and the user picks. The server offers; the human
 * narrows.
 */
export function bearerChallenge(scopes: readonly McpScope[] = MCP_SCOPES): string {
  return `Bearer resource_metadata="${protectedResourceMetadataUrl()}", scope="${formatScopes(scopes)}"`
}

/** `WWW-Authenticate` for a 403 — authenticated, but the grant is too narrow. */
export function insufficientScopeChallenge(scope: McpScope): string {
  return `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${protectedResourceMetadataUrl()}"`
}
