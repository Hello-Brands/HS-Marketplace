// Cross-cutting read tools: the marketplace headline, the activity feed, the audit log.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { AUDIT_TARGET_TYPES } from "@/db/schema/adminAuditLog"
import { getRecentActivity, type ActivityKind } from "@/lib/admin/activity"
import { marketplaceOverview } from "@/lib/mcp/queries/overview"
import { listAuditLog } from "@/lib/mcp/queries/audit"
import {
  DEFAULT_LIMIT,
  READ_ANNOTATIONS,
  cursorField,
  limitField,
  readTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

const ACTIVITY_KINDS = [
  "admin_action",
  "listing_created",
  "listing_listed",
  "listing_updated",
  "inquiry",
  "favorite",
  "login",
  "brand_request_submitted",
  "brand_request_decided",
  "owner_link_changed",
] as const satisfies readonly ActivityKind[]

const sinceField = z.iso
  .datetime()
  .optional()
  .describe("ISO 8601 timestamp; only events at or after this moment are returned.")

export function registerOverviewTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "get_marketplace_overview",
    {
      title: "Marketplace overview",
      description:
        "Current state of the whole marketplace in one call: listing counts by status, " +
        "the size of the pending approval queue, open competitor-brand requests, user and " +
        "admin counts, and inquiry/login activity over the last 7 and 30 days. Start here " +
        "when asked how the marketplace is doing. Takes no arguments.",
      inputSchema: z.object({}),
      annotations: READ_ANNOTATIONS,
    },
    async () =>
      readTool(ctx, "get_marketplace_overview", {}, async () => {
        return { ...(await marketplaceOverview()) }
      }),
  )

  server.registerTool(
    "list_recent_activity",
    {
      title: "List recent activity",
      description:
        "Chronological feed of everything that has happened on the marketplace: admin " +
        "actions, listing creations and status changes, buyer inquiries, favorites, logins, " +
        "brand requests and owner-link changes. Newest first. Use `kinds` to narrow to one " +
        "or more event types and `actor_user_id` to follow one person. Returns " +
        "{ items, next_cursor }; pass next_cursor back as `cursor` for the following page.",
      inputSchema: z.object({
        kinds: z
          .array(z.enum(ACTIVITY_KINDS))
          .max(ACTIVITY_KINDS.length)
          .optional()
          .describe("Restrict the feed to these event kinds. Omit for all kinds."),
        actor_user_id: z
          .string()
          .max(64)
          .optional()
          .describe("Only events performed by this user id."),
        since: sinceField,
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_recent_activity", args, async () => {
        const page = await getRecentActivity({
          kinds: args.kinds as ActivityKind[] | undefined,
          actorUserId: args.actor_user_id,
          since: args.since ? new Date(args.since) : undefined,
          cursor: args.cursor,
          limit: args.limit ?? DEFAULT_LIMIT,
        })
        return {
          items: page.items.map((item) => ({ ...item, at: item.at.toISOString() })),
          next_cursor: page.nextCursor,
        }
      }),
  )

  server.registerTool(
    "list_audit_log",
    {
      title: "List admin audit log",
      description:
        "Raw admin audit log: one row per admin mutation from either the web UI or this " +
        "MCP connection, with the actor, the arguments, the outcome and the duration. " +
        "`mcp.read` rows (one per MCP read) are hidden unless include_reads is true. " +
        "Use this to answer 'who changed X and when'. Newest first; " +
        "returns { items, next_cursor }.",
      inputSchema: z.object({
        actor_user_id: z.string().max(64).optional().describe("Only rows for this actor's user id."),
        action: z
          .string()
          .max(64)
          .optional()
          .describe('Exact dotted action, e.g. "listing.approve" or "user.set_role".'),
        target_type: z
          .enum(AUDIT_TARGET_TYPES)
          .optional()
          .describe("Only rows whose target is of this type."),
        target_id: z.string().max(64).optional().describe("Only rows touching this target id."),
        source: z
          .enum(["ui", "mcp"])
          .optional()
          .describe("Where the action came from: the admin web UI, or an MCP connection."),
        since: sinceField,
        include_reads: z
          .boolean()
          .optional()
          .describe("Include the high-volume mcp.read rows. Default false."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_audit_log", args, async () =>
        listAuditLog({
          actorUserId: args.actor_user_id,
          action: args.action,
          targetType: args.target_type,
          targetId: args.target_id,
          source: args.source,
          since: args.since ? new Date(args.since) : undefined,
          includeReads: args.include_reads,
          limit: args.limit ?? DEFAULT_LIMIT,
          cursor: args.cursor,
        }),
      ),
  )
}
