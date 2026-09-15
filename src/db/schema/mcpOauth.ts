import {
  pgTable,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core"
import { users } from "./auth"

/**
 * OAuth 2.1 authorization-server tables for the admin MCP endpoint
 * (spec §4.1, migration 0012).
 *
 * Secrets discipline: `mcp_oauth_codes.code_hash`, `mcp_oauth_tokens.token_hash`
 * and `mcp_oauth_tokens.refresh_token_hash` hold SHA-256 hex digests, never the
 * value itself. A database dump therefore yields nothing a client could present.
 * Do NOT add a plaintext column for debugging.
 *
 * Every timestamp is timestamptz: these instants are compared against `now()`
 * from a serverless runtime whose local zone is not ours.
 */

/**
 * Pre-registered clients. There is no Dynamic Client Registration in v1, so
 * rows arrive only from scripts/seed-mcp-clients.ts. `redirect_uris` is matched
 * exactly, except that loopback URIs ignore the port
 * (RFC 8252 §7.3 — Claude Code binds an ephemeral port).
 */
export const mcpOauthClients = pgTable("mcp_oauth_clients", {
  clientId: text("client_id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  // true = public client: PKCE only, no client secret. Both seeded clients are
  // public; the token endpoint advertises token_endpoint_auth_methods_supported
  // ["none"] to match.
  isPublic: boolean("is_public").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

/** Single-use authorization codes. 5-minute TTL; `used_at` enforces single use. */
export const mcpOauthCodes = pgTable(
  "mcp_oauth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOauthClients.clientId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Must equal the value presented at the token endpoint, byte for byte.
    redirectUri: text("redirect_uri").notNull(),
    // PKCE S256 challenge. `plain` is neither accepted nor advertised.
    codeChallenge: text("code_challenge").notNull(),
    // Space-separated, a subset of MCP_SCOPES.
    scope: text("scope").notNull(),
    // RFC 8707 resource indicator — the exact MCP endpoint URL.
    resource: text("resource").notNull(),
    // Optional connection label typed on the consent screen (max 60 chars).
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Postgres does not auto-index FKs; the user cascade and the client join
    // would otherwise sequential-scan.
    index("mcp_oauth_codes_user_id_idx").on(table.userId),
    index("mcp_oauth_codes_client_id_idx").on(table.clientId),
    index("mcp_oauth_codes_expires_at_idx").on(table.expiresAt),
  ],
)

/**
 * One row per grant, holding the access/refresh pair. Refresh ROTATES both
 * hashes in place and extends both expiries, so the previous access token stops
 * working immediately — there is never a second live row for one grant.
 */
export const mcpOauthTokens = pgTable(
  "mcp_oauth_tokens",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tokenHash: text("token_hash").notNull().unique(),
    refreshTokenHash: text("refresh_token_hash").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => mcpOauthClients.clientId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
    }).notNull(),
    // Touched at most once per 60 s by verifyMcpToken, so a busy client does
    // not turn every MCP call into a write.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("mcp_oauth_tokens_user_id_idx").on(table.userId),
    index("mcp_oauth_tokens_client_id_idx").on(table.clientId),
    index("mcp_oauth_tokens_expires_at_idx").on(table.expiresAt),
  ],
)

export type McpOauthClient = typeof mcpOauthClients.$inferSelect
export type McpOauthCode = typeof mcpOauthCodes.$inferSelect
export type McpOauthToken = typeof mcpOauthTokens.$inferSelect
