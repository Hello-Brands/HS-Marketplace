// Listing-location to BigQuery data-source mappings.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { setLocationMapping } from "@/lib/admin/core/data-mappings"
import { unresolvedMappings } from "@/lib/mcp/queries/data-mappings"
import {
  READ_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  readTool,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

export function registerDataTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_unresolved_data_mappings",
    {
      title: "List unresolved data mappings",
      description:
        "Salon locations whose BigQuery data-source mapping is still unconfirmed. A listing " +
        "cannot be approved while any of its salon locations is on this list, because an " +
        "unconfirmed mapping would surface the wrong location's financials. Each row carries " +
        "a suggested BigQuery location name when one scores highly enough. `bq_configured` " +
        "is false when BigQuery is unreachable — then every suggestion is null and absence " +
        "of a suggestion means nothing.",
      inputSchema: z.object({}),
      annotations: READ_ANNOTATIONS,
    },
    async () =>
      readTool(ctx, "list_unresolved_data_mappings", {}, async () => ({
        ...(await unresolvedMappings()),
      })),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "set_location_data_mapping",
    {
      title: "Set location data mapping",
      description:
        'Resolve one salon location\'s data source. Use status "confirmed" with the exact ' +
        "BigQuery location name (from list_unresolved_data_mappings' suggestion, or " +
        'list_owner_directory\'s resolved_bq_location_name), or status "not_connected" to ' +
        "record that this location has no financial data source. Confirming also stamps the " +
        "location's coordinates from Monday when they are available. Reversible by calling " +
        "again, so it executes immediately.",
      inputSchema: z.object({
        location_id: z.string().min(1).max(64).describe("The listing location's id."),
        status: z
          .enum(["confirmed", "not_connected"])
          .describe('"confirmed" requires bq_location_name; "not_connected" ignores it.'),
        bq_location_name: z
          .string()
          .max(200)
          .optional()
          .describe("Exact BigQuery LOCATION_NAME string. Required when status is confirmed."),
      }),
      annotations: { ...WRITE_ANNOTATIONS, idempotentHint: true },
    },
    async (args) =>
      writeTool(ctx, "set_location_data_mapping", args, async () => {
        const bqLocationName = args.status === "confirmed" ? (args.bq_location_name ?? null) : null
        const result = await setLocationMapping(ctx.actor, args.location_id, {
          bqLocationName,
          status: args.status,
        })
        // This core returns { ok: false } rather than throwing, because Next redacts
        // thrown server-action messages in production. Convert it to a tool error here.
        if (!result.ok) throw new Error(result.error)
        return {
          audit_id: result.auditId,
          target: {
            type: "listing_location",
            id: args.location_id,
            data_mapping_status: args.status,
            bq_location_name: bqLocationName,
          },
        }
      }),
  )
}
