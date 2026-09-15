// The MCP's view of its own OAuth grants.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { listMcpConnections, revokeMcpToken, type McpConnectionRow } from "@/lib/mcp/oauth/grants"
import { mcpConnectionStatus } from "@/lib/mcp/oauth/connection-status"
import { requireConfirmation } from "@/lib/mcp/confirm"
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
  confirmationField,
  cursorField,
  limitField,
  paginateArray,
  readTool,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

const tokenIdField = z
  .string()
  .min(1)
  .max(64)
  .describe("The grant's token_id, from list_mcp_connections.")

/**
 * One grant on the wire. Status comes from PR B's `mcpConnectionStatus`, the same
 * function the admin table uses, so the two surfaces can never disagree about what
 * "expired" means (refresh token gone) versus "idle" (only the access token lapsed).
 */
function projectConnection(row: McpConnectionRow, currentTokenId: string) {
  return {
    token_id: row.id,
    client_id: row.clientId,
    client_name: row.clientName,
    label: row.label,
    scopes: row.scope.split(" ").filter(Boolean),
    status: mcpConnectionStatus(row),
    user: { id: row.userId, email: row.userEmail },
    created_at: row.createdAt.toISOString(),
    last_used_at: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expires_at: row.expiresAt.toISOString(),
    refresh_expires_at: row.refreshExpiresAt.toISOString(),
    revoked_at: row.revokedAt ? row.revokedAt.toISOString() : null,
    is_current_connection: row.id === currentTokenId,
  }
}

export function registerConnectionTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_mcp_connections",
    {
      title: "List MCP connections",
      description:
        "OAuth grants that can reach this MCP server. Shows your own connections by default; " +
        "set all: true to see every admin's. Each row carries the client (claude-hosted for " +
        "Claude.ai, claude-code for the CLI), the granted scopes, when it was last used, and " +
        'its status: "active", "idle" (access token lapsed, the client renews on its next ' +
        'call), "expired" (the refresh token is gone too) or "revoked". ' +
        "`is_current_connection` marks the grant this very request is authenticated with. " +
        "Returns { items, next_cursor }.",
      inputSchema: z.object({
        all: z.boolean().optional().describe("Include every admin's connections, not just yours."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_mcp_connections", args, async () => {
        const rows = await listMcpConnections({
          userId: ctx.actor.userId,
          all: args.all ?? false,
        })
        const page = paginateArray(rows, args.limit, args.cursor)
        return {
          items: page.items.map((row) => projectConnection(row, ctx.mcp.tokenId)),
          next_cursor: page.next_cursor,
        }
      }),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "revoke_mcp_connection",
    {
      title: "Revoke MCP connection",
      description:
        "Revoke one of YOUR OWN MCP connections immediately. Its access and refresh tokens " +
        "stop working at once and the client must go through the OAuth consent flow again. " +
        "You cannot revoke another admin's connection from here — use /admin/mcp-connections " +
        "for that. DESTRUCTIVE: preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        token_id: tokenIdField,
        confirmation_token: confirmationField,
      }),
      // Idempotent: revoking an already-revoked grant leaves the original
      // revocation timestamp alone and reports success.
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "revoke_mcp_connection", args, async () => {
        const { confirmation_token, ...rest } = args
        // Own grants only (spec §7.4), so the lookup is scoped the same way the
        // revoke is. Pre-checked before a token is ever minted: revokeMcpToken with
        // ownOnly would refuse anyway, and this way the model learns immediately
        // that the id is wrong instead of after a confirmation round trip.
        const rows = await listMcpConnections({ userId: ctx.actor.userId, all: false })
        const grant = rows.find((row) => row.id === rest.token_id)
        if (!grant) throw new Error("Connection not found")

        const isSelf = grant.id === ctx.mcp.tokenId
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "revoke_mcp_connection",
          rest,
          confirmation_token,
          `Revoke the MCP connection "${grant.label ?? grant.id}" (${grant.clientName}, ${grant.clientId}).` +
            (isSelf
              ? " THIS IS THE CONNECTION YOU ARE USING RIGHT NOW — every following call will fail until the client re-authorises."
              : " That client must go through the OAuth consent flow again."),
        )
        if (prompt) return { ...prompt }

        // No withAudit wrapper here: revokeMcpToken is itself the audited core
        // mutation (action "mcp_token.revoke") and hands back the row's id.
        const result = await revokeMcpToken(ctx.actor, { tokenId: rest.token_id, ownOnly: true })
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: { type: "mcp_token", id: rest.token_id, revoked: true },
        }
      }),
  )
}
