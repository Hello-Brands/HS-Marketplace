// Per-request MCP server assembly.
//
// NOT a use server module.
//
// The v2 SDK serves HTTP through a FACTORY, not a long-lived server: createMcpHandler
// calls the factory once per request and the instance is discarded afterwards. That is
// exactly what lets the tool set vary by caller — a read-only token simply never has
// the write tools registered, so tools/list filters itself with no extra machinery.
// Never hoist an McpServer to module scope.
import { McpServer, createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server"
import * as Sentry from "@sentry/nextjs"
import type { McpActor } from "@/lib/mcp/auth/verify-token"
import { toolContext } from "@/lib/mcp/tools/_shared"
import { registerOverviewTools } from "@/lib/mcp/tools/overview"

export const MCP_SERVER_NAME = "hs-marketplace-mcp-server"
export const MCP_SERVER_TITLE = "Hello Sugar Marketplace Admin"
export const MCP_SERVER_VERSION = "1.0.0"

/**
 * Every tool that mutates. Two jobs:
 *  - the route rejects a `tools/call` naming one of these with HTTP 403
 *    `insufficient_scope` when the token is read-only, instead of the bare
 *    "unknown tool" the omitted registration would otherwise produce;
 *  - the server test diffs a write-scoped tools/list against a read-scoped one and
 *    asserts the difference is exactly this set, so the list cannot drift.
 * Mirrors spec §7.4 exactly.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "approve_listing",
  "reject_listing",
  "update_listing",
  "mark_listing_sold",
  "set_user_role",
  "set_seller_access",
  "add_to_allowlist",
  "remove_from_allowlist",
  "remove_user",
  "approve_brand_request",
  "reject_brand_request",
  "retry_brand_request_dispatch",
  "add_owner_link",
  "revoke_owner_link",
  "clear_owner_link",
  "set_location_data_mapping",
  "refresh_owner_directory",
  "revoke_mcp_connection",
])

const INSTRUCTIONS = [
  "Administrative access to the Hello Sugar marketplace. Read tools describe live",
  "production data; write tools perform the same actions an admin can perform in the",
  "web UI at /admin, and every one of them is recorded in the admin audit log.",
  "Tools marked destructive return a preview and a confirmation_token on the first",
  "call and change nothing; call them again with that token, and identical arguments,",
  "to execute. Money is always reported in integer cents alongside a formatted string.",
].join(" ")

/**
 * Build the MCP server for ONE request, bound to one verified token.
 *
 * Each domain module decides internally whether to register its write tools, using
 * `ctx.canWrite`. Adding a domain is one import and one call here.
 */
export function buildMcpServer(actor: McpActor): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, title: MCP_SERVER_TITLE, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  )
  const ctx = toolContext(actor)

  registerOverviewTools(server, ctx)

  return server
}

/**
 * The production handler options, in one place so the test harness drives exactly
 * what Vercel does.
 *
 * `responseMode: "json"` — this endpoint has no long-running tools and publishes no
 * mid-call progress, so a single JSON body is the right answer and avoids holding an
 * SSE stream open on a serverless function.
 * `legacy: "stateless"` (the SDK default, stated explicitly) — Claude clients may still
 * open with the 2025-era handshake, and each such request is served by its own instance.
 */
export function createMcpRequestHandler(actor: McpActor): McpHttpHandler {
  return createMcpHandler(() => buildMcpServer(actor), {
    responseMode: "json",
    legacy: "stateless",
    onerror: (error) => {
      Sentry.captureException(error, { tags: { mcp_stage: "handler" } })
    },
  })
}
