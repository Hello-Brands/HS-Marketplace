// Buyer inquiries (the `contacts` table) — read only; the MCP never writes one.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import { getInquiries } from "@/lib/admin/core/inquiries"
import {
  READ_ANNOTATIONS,
  cursorField,
  limitField,
  paginateArray,
  readTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

/**
 * How many rows the admin read is asked for. `getInquiries` defaults to 100, which
 * is the admin page's screenful — far too narrow for a tool that also filters by
 * listing and by date in memory, where the match could be the 300th newest row.
 */
const INQUIRY_WINDOW = 1000

type InquiryRow = {
  id: string
  message: string | null
  buyerName: string | null
  buyerEmail: string | null
  buyerPhone: string | null
  createdAt: Date
  listingId: string
  listingTitle: string | null
  listingLocationName: string | null
  listingCity: string | null
  listingState: string | null
  sellerName: string | null
  sellerEmail: string | null
}

export function registerInquiryTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_inquiries",
    {
      title: "List buyer inquiries",
      description:
        "Buyer reach-outs on listings, newest first, with the buyer's contact details, the " +
        "listing they asked about and that listing's seller. Narrow to one listing with " +
        "listing_id, or to a time window with since. Returns { items, next_cursor }. " +
        `Covers the ${INQUIRY_WINDOW.toLocaleString("en-US")} most recent inquiries; use ` +
        "listing_id or since to narrow rather than paging to the end.",
      inputSchema: z.object({
        listing_id: z.string().max(64).optional().describe("Only inquiries on this listing."),
        since: z.iso
          .datetime()
          .optional()
          .describe("ISO 8601 timestamp; only inquiries at or after this moment."),
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_inquiries", args, async () => {
        const rows = (await getInquiries({ limit: INQUIRY_WINDOW })) as InquiryRow[]
        const since = args.since ? new Date(args.since) : null
        const filtered = rows.filter((row) => {
          if (args.listing_id && row.listingId !== args.listing_id) return false
          if (since && row.createdAt < since) return false
          return true
        })
        const page = paginateArray(filtered, args.limit, args.cursor)
        return {
          items: page.items.map((r) => ({
            id: r.id,
            at: r.createdAt.toISOString(),
            message: r.message,
            buyer: { name: r.buyerName, email: r.buyerEmail, phone: r.buyerPhone },
            listing: {
              id: r.listingId,
              title: r.listingTitle,
              location: r.listingLocationName,
              city: r.listingCity,
              state: r.listingState,
            },
            seller: { name: r.sellerName, email: r.sellerEmail },
          })),
          next_cursor: page.next_cursor,
        }
      }),
  )
}
