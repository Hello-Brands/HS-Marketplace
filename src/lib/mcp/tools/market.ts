// Read-only market context: scraper-owned competitor closures and buyer saved searches.
//
// NOT a use server module.
//
// `competitor_opportunities` is owned end to end by the external competitor-monitor
// scraper. Nothing here writes to it, and no write tool for it exists.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { getCompetitorClosures } from "@/lib/competitor-query"
import { listAlerts } from "@/lib/mcp/queries/alerts"
import {
  DEFAULT_LIMIT,
  READ_ANNOTATIONS,
  cursorField,
  limitField,
  paginateArray,
  readTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

export function registerMarketTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_competitor_closures",
    {
      title: "List competitor closures",
      description:
        "Competitor salon locations the monitoring scraper has found closed, with the nearest " +
        "Hello Sugar location and whether the scraper flagged the site as an opportunity. " +
        "`closure_detected_at` is when the SCRAPER FIRST SAW the closure, not when the " +
        "business closed, and it is null on many rows — never present it as a closing date. " +
        "Supply center_lat, center_lng and radius_miles together to search a radius; " +
        "`states` narrows by two-letter state code. Read-only: this data belongs to the " +
        "external scraper. Returns { items, next_cursor }.",
      inputSchema: z.object({
        center_lat: z.number().min(-90).max(90).optional().describe("Search centre latitude."),
        center_lng: z.number().min(-180).max(180).optional().describe("Search centre longitude."),
        radius_miles: z
          .number()
          .positive()
          .max(5000)
          .optional()
          .describe("Search radius in miles. Needs center_lat and center_lng too."),
        states: z
          .array(z.string().length(2))
          .max(60)
          .optional()
          .describe("Two-letter US state codes to include."),
        opportunities_only: z
          .boolean()
          .optional()
          .describe("Only closures the scraper flagged as an opportunity."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_competitor_closures", args, async () => {
        // A scope is passed only when the caller actually narrowed something.
        // `getCompetitorClosures(scope)` runs its state/radius filter whenever a
        // scope object exists, so handing it an all-undefined one would be a no-op
        // at best and a partial filter at worst.
        const hasScope =
          args.center_lat !== undefined ||
          args.center_lng !== undefined ||
          args.radius_miles !== undefined ||
          args.states !== undefined
        const rows = await getCompetitorClosures(
          hasScope
            ? {
                centerLat: args.center_lat,
                centerLng: args.center_lng,
                radiusMiles: args.radius_miles,
                states: args.states,
              }
            : undefined,
        )
        const filtered = args.opportunities_only ? rows.filter((r) => r.isOpportunity) : rows
        const page = paginateArray(filtered, args.limit, args.cursor)
        return {
          items: page.items.map((r) => ({
            google_place_id: r.googlePlaceId,
            brand_id: r.brandId,
            brand_name: r.brandName,
            address: r.address,
            city: r.city,
            state: r.state,
            latitude: r.latitude,
            longitude: r.longitude,
            business_status: r.businessStatus,
            // Named for what it is: detection time, not closing time.
            closure_detected_at: r.closedAt,
            nearest_hs_name: r.nearestHsName,
            nearest_hs_miles: r.nearestHsMiles,
            is_opportunity: r.isOpportunity,
            maps_url: r.mapsUrl,
          })),
          next_cursor: page.next_cursor,
        }
      }),
  )

  server.registerTool(
    "list_alerts",
    {
      title: "List saved searches",
      description:
        "Buyer saved searches (alerts) with their criteria and their owner. `origin` is " +
        '"user" for a search a buyer saved themselves and "owner-auto" for one created ' +
        "automatically around a franchise owner's locations. Money criteria are in cents " +
        "with a formatted string. Returns { items, next_cursor }.",
      inputSchema: z.object({
        user_id: z.string().max(64).optional().describe("Only this user's saved searches."),
        origin: z
          .enum(["user", "owner-auto"])
          .optional()
          .describe("Filter by how the search was created."),
        notify_enabled: z
          .boolean()
          .optional()
          .describe("Only searches with email notifications on (true) or off (false)."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_alerts", args, async () =>
        listAlerts({
          userId: args.user_id,
          origin: args.origin,
          notifyEnabled: args.notify_enabled,
          limit: args.limit ?? DEFAULT_LIMIT,
          cursor: args.cursor,
        }),
      ),
  )
}
