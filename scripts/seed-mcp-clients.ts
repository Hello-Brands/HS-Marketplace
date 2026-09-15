/**
 * Seed the pre-registered OAuth clients for the admin MCP server.
 *
 * Run:  npx tsx --env-file=.env.local scripts/seed-mcp-clients.ts
 *
 * Requires DATABASE_URL in .env.local, and migration 0012 applied first —
 * without the table this fails with a Postgres "relation does not exist".
 *
 * Safe to re-run: every write is an upsert keyed on client_id, so an
 * interrupted run can simply be run again, and editing MCP_SEED_CLIENTS then
 * re-running is how a redirect URI is changed. Existing grants are untouched —
 * the tokens table references client_id, which never changes here.
 *
 * Imports only `../src/db` and the DB-free definitions module: a standalone
 * tsx script crashes on any transitive `import "server-only"`, which
 * src/__tests__/scripts/script-import-graph.test.ts checks statically.
 */
import { db } from "../src/db"
import { mcpOauthClients } from "../src/db/schema/mcpOauth"
import { MCP_SEED_CLIENTS } from "../src/lib/mcp/oauth/seed-clients"

async function main() {
  for (const client of MCP_SEED_CLIENTS) {
    await db
      .insert(mcpOauthClients)
      .values({
        clientId: client.clientId,
        name: client.name,
        redirectUris: client.redirectUris,
        isPublic: client.isPublic,
      })
      .onConflictDoUpdate({
        target: mcpOauthClients.clientId,
        set: {
          name: client.name,
          redirectUris: client.redirectUris,
          isPublic: client.isPublic,
        },
      })
    console.log(`seeded ${client.clientId} -> ${client.redirectUris.join(", ")}`)
  }
  console.log(`done: ${MCP_SEED_CLIENTS.length} clients`)
  process.exit(0)
}

main().catch((err) => {
  console.error("seed-mcp-clients failed:", err)
  process.exit(1)
})
