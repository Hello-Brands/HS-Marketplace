// Listing reads and the four admin listing writes.
//
// NOT a use server module.
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/server"
import {
  getAllListings,
  approveListing,
  rejectListing,
  adminUpdateListing,
  adminMarkSold,
} from "@/lib/admin/core/listings"
import { queryAdminListing } from "@/lib/listings/load-listing"
import { parseListingPatch } from "@/lib/listings/schemas"
import { canTransition } from "@/lib/listings/status-machine"
import type { ListingFormData, ListingStatus } from "@/lib/listings/types"
import { listingExtras } from "@/lib/mcp/queries/listings"
import { requireConfirmation } from "@/lib/mcp/confirm"
import {
  DESTRUCTIVE_ANNOTATIONS,
  READ_ANNOTATIONS,
  REQUIRES_USER_INTERACTION,
  WRITE_ANNOTATIONS,
  confirmationField,
  cursorField,
  limitField,
  money,
  notesField,
  paginateArray,
  readTool,
  reasonField,
  searchField,
  writeTool,
  type McpToolContext,
} from "@/lib/mcp/tools/_shared"

const LISTING_STATUSES = ["draft", "pending", "active", "rejected", "sold", "delisted"] as const
const LISTING_TYPES = ["suite", "flagship", "territory", "bundle"] as const

const listingIdField = z.string().min(1).max(64).describe("The listing's id.")

type LocationRow = {
  id: string
  name: string
  locationType: string
  city: string | null
  state: string | null
  dataMappingStatus: string
  displayOrder: number
}

type ListingRow = {
  id: string
  sellerId: string
  type: string
  status: string
  title: string | null
  askingPrice: number
  ttmProfit: number | null
  inventoryIncluded: boolean
  laserIncluded: boolean
  inventoryCostEstimate: number | null
  otherAssets: string | null
  reasonForSelling: string | null
  notes: string | null
  rejectionReason: string | null
  viewCount: number
  inquiryCount: number
  createdAt: Date
  listedAt: Date | null
  updatedAt: Date
  locations?: LocationRow[]
  photos?: { id: string; url: string; displayOrder: number }[]
  seller?: { id: string; name: string | null; email: string | null } | null
}

/** One projection for both the list and the detail tool, so they never disagree. */
function listingSummary(row: ListingRow): Record<string, unknown> {
  const primary = row.locations?.find((l) => l.displayOrder === 0) ?? row.locations?.[0]
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    type: row.type,
    asking_price: money(row.askingPrice),
    ttm_profit: money(row.ttmProfit),
    inventory_included: row.inventoryIncluded,
    laser_included: row.laserIncluded,
    inventory_cost_estimate: money(row.inventoryCostEstimate),
    other_assets: row.otherAssets,
    reason_for_selling: row.reasonForSelling,
    notes: row.notes,
    rejection_reason: row.rejectionReason,
    view_count: row.viewCount,
    inquiry_count: row.inquiryCount,
    created_at: row.createdAt.toISOString(),
    listed_at: row.listedAt ? row.listedAt.toISOString() : null,
    updated_at: row.updatedAt.toISOString(),
    primary_location: primary
      ? { name: primary.name, city: primary.city, state: primary.state }
      : null,
    seller: row.seller
      ? { id: row.seller.id, name: row.seller.name, email: row.seller.email }
      : { id: row.sellerId, name: null, email: null },
  }
}

function listingDetail(row: ListingRow): Record<string, unknown> {
  return {
    ...listingSummary(row),
    locations: (row.locations ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      location_type: l.locationType,
      city: l.city,
      state: l.state,
      data_mapping_status: l.dataMappingStatus,
      display_order: l.displayOrder,
    })),
    photos: (row.photos ?? []).map((p) => ({ id: p.id, url: p.url, display_order: p.displayOrder })),
  }
}

/** Load a listing or refuse with the exact sentence the core functions use. */
async function loadOrThrow(listingId: string): Promise<ListingRow> {
  const row = (await queryAdminListing(listingId)) as ListingRow | undefined
  if (!row) throw new Error("Listing not found")
  return row
}

export function registerListingTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_listings",
    {
      title: "List listings",
      description:
        "Every listing an admin can see, newest first, with money as { cents, formatted }. " +
        "Filter by status (draft/pending/active/rejected/sold/delisted), type, two-letter " +
        "state, seller id, or a case-insensitive `search` matched against the title and the " +
        "location names. Returns { items, next_cursor }. Use get_listing for the full record.",
      inputSchema: z.object({
        status: z.enum(LISTING_STATUSES).optional().describe("Only listings in this status."),
        type: z.enum(LISTING_TYPES).optional().describe("Only listings of this type."),
        state: z
          .string()
          .length(2)
          .optional()
          .describe("Two-letter US state code of any of the listing's locations, e.g. CO."),
        seller_id: z.string().max(64).optional().describe("Only listings owned by this seller id."),
        search: searchField,
        limit: limitField,
        cursor: cursorField,
      }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "list_listings", args, async () => {
        const rows = (await getAllListings(args.status as ListingStatus | undefined)) as ListingRow[]
        const needle = args.search?.trim().toLowerCase()
        const filtered = rows.filter((row) => {
          if (args.type && row.type !== args.type) return false
          if (args.seller_id && row.sellerId !== args.seller_id) return false
          if (args.state && !(row.locations ?? []).some((l) => l.state === args.state)) return false
          if (needle) {
            const haystack = [row.title ?? "", ...(row.locations ?? []).map((l) => l.name)]
              .join(" ")
              .toLowerCase()
            if (!haystack.includes(needle)) return false
          }
          return true
        })
        const page = paginateArray(filtered, args.limit, args.cursor)
        return { items: page.items.map(listingSummary), next_cursor: page.next_cursor }
      }),
  )

  server.registerTool(
    "get_listing",
    {
      title: "Get listing",
      description:
        "One listing in full: every scalar field, its ordered locations (with data-mapping " +
        "status) and photos, the seller, the most recent buyer inquiries, view counts, and " +
        "the audit history for that listing. Use this before any write so you can quote the " +
        "listing's current state back to the admin.",
      inputSchema: z.object({ listing_id: listingIdField }),
      annotations: READ_ANNOTATIONS,
    },
    async (args) =>
      readTool(ctx, "get_listing", args, async () => {
        const row = await loadOrThrow(args.listing_id)
        const extras = await listingExtras(args.listing_id)
        return { listing: listingDetail(row), ...extras }
      }),
  )

  if (!ctx.canWrite) return

  server.registerTool(
    "approve_listing",
    {
      title: "Approve listing",
      description:
        "Move a pending listing to active. Sends the seller the approval email and runs " +
        "buyer alert matching, exactly as the /admin/queue button does. Refuses if the " +
        "listing is not pending or if any salon location's data-source mapping is still " +
        "unconfirmed — resolve those with set_location_data_mapping first. Not destructive, " +
        "so it executes immediately.",
      inputSchema: z.object({ listing_id: listingIdField }),
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      writeTool(ctx, "approve_listing", args, async () => {
        const result = await approveListing(ctx.actor, args.listing_id)
        return {
          audit_id: result.auditId,
          target: listingSummary(await loadOrThrow(args.listing_id)),
        }
      }),
  )

  server.registerTool(
    "reject_listing",
    {
      title: "Reject listing",
      description:
        "Reject a pending listing with a reason. The reason is emailed to the seller and " +
        "stored on the listing, so write it for the seller to read. DESTRUCTIVE: call once " +
        "without confirmation_token to get a preview and a token, then call again with the " +
        "token and identical arguments to execute.",
      inputSchema: z.object({
        listing_id: listingIdField,
        reason: reasonField,
        notes: notesField,
        confirmation_token: confirmationField,
      }),
      annotations: DESTRUCTIVE_ANNOTATIONS,
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "reject_listing", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadOrThrow(rest.listing_id)
        // Same pre-check the core runs, so a doomed call never mints a token.
        if (!canTransition(row.status as ListingStatus, "rejected", "admin")) {
          throw new Error(`Cannot reject listing with status ${row.status}`)
        }
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "reject_listing",
          rest,
          confirmation_token,
          `Reject listing "${row.title ?? row.id}" (${row.id}, currently ${row.status}) with reason "${rest.reason}". This emails the seller and cannot be undone from this connection.`,
        )
        if (prompt) return { ...prompt }
        const result = await rejectListing(ctx.actor, rest.listing_id, rest.reason, rest.notes)
        return {
          audit_id: result.auditId,
          target: listingSummary(await loadOrThrow(rest.listing_id)),
        }
      }),
  )

  server.registerTool(
    "update_listing",
    {
      title: "Update listing",
      description:
        "Edit a listing's fields, exactly as the /admin/listings edit form does. `patch` is " +
        "a partial listing object; only the keys you send are changed. Accepted keys: type, " +
        "askingPrice, ttmProfit, reasonForSelling (max 500), notes (max 2000), " +
        "inventoryIncluded, laserIncluded, inventoryCostEstimate, otherAssets (max 500). " +
        "MONEY IN THIS PATCH IS IN WHOLE DOLLARS, not cents — the same unit the admin form " +
        "uses; the server converts to cents on write. (Read tools report cents.) " +
        "DESTRUCTIVE: preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        listing_id: listingIdField,
        patch: z
          .record(z.string(), z.unknown())
          .describe(
            "Partial listing object. Validated server-side by the same schema the admin form " +
              "uses; unknown keys are stripped and an invalid value is refused with its path.",
          ),
        confirmation_token: confirmationField,
      }),
      annotations: { ...DESTRUCTIVE_ANNOTATIONS, idempotentHint: true },
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "update_listing", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadOrThrow(rest.listing_id)
        // Validate before minting a token: parseListingPatch throws with the offending
        // paths, which is far more useful than a token the second call would reject.
        const parsed = parseListingPatch(rest.patch)
        const fields = Object.keys(parsed).sort().join(", ")
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "update_listing",
          rest,
          confirmation_token,
          `Update listing "${row.title ?? row.id}" (${row.id}): change ${fields}.`,
        )
        if (prompt) return { ...prompt }
        // Pass the RAW patch, not `parsed`: adminUpdateListing parses it itself and owns
        // the dollars-to-cents conversion. Handing it pre-parsed output would double-apply
        // nothing today but would silently diverge the moment the core adds a step.
        const result = await adminUpdateListing(
          ctx.actor,
          rest.listing_id,
          rest.patch as Partial<ListingFormData>,
        )
        return {
          audit_id: result.auditId,
          target: listingSummary(await loadOrThrow(rest.listing_id)),
        }
      }),
  )

  server.registerTool(
    "mark_listing_sold",
    {
      title: "Mark listing sold",
      description:
        "Move an active listing to sold. Removes it from browse. Only an active listing can " +
        "be marked sold. DESTRUCTIVE: preview first, then re-send with confirmation_token.",
      inputSchema: z.object({
        listing_id: listingIdField,
        confirmation_token: confirmationField,
      }),
      annotations: DESTRUCTIVE_ANNOTATIONS,
      _meta: REQUIRES_USER_INTERACTION,
    },
    async (args) =>
      writeTool(ctx, "mark_listing_sold", args, async () => {
        const { confirmation_token, ...rest } = args
        const row = await loadOrThrow(rest.listing_id)
        if (!canTransition(row.status as ListingStatus, "sold", "admin")) {
          throw new Error(`Cannot mark listing as sold from status ${row.status}`)
        }
        const prompt = requireConfirmation(
          ctx.actor.userId,
          "mark_listing_sold",
          rest,
          confirmation_token,
          `Mark listing "${row.title ?? row.id}" (${row.id}) as sold. It stops appearing in browse.`,
        )
        if (prompt) return { ...prompt }
        const result = await adminMarkSold(ctx.actor, rest.listing_id)
        return {
          audit_id: result.auditId,
          target: listingSummary(await loadOrThrow(rest.listing_id)),
        }
      }),
  )
}
