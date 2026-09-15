// Per-listing context the admin detail page shows around the listing itself.
//
// NOT a use server module.
import { countDistinct, desc, eq } from "drizzle-orm"
import { db } from "@/db"
import { contacts } from "@/db/schema/contacts"
import { listings } from "@/db/schema/listings"
import { listingViews } from "@/db/schema/listingViews"
import { listAuditLog, type AuditLogEntry } from "@/lib/mcp/queries/audit"

const RECENT_INQUIRY_LIMIT = 10
const AUDIT_HISTORY_LIMIT = 20

export interface ListingExtras {
  recent_inquiries: {
    id: string
    at: string
    buyer_name: string | null
    buyer_email: string | null
    buyer_phone: string | null
    message: string | null
  }[]
  views: {
    /** The denormalised counter on the listing row (what the UI shows). */
    counter: number
    /** Distinct signed-in viewers recorded in listing_views. */
    distinct_viewers: number
  }
  audit_history: AuditLogEntry[]
}

export async function listingExtras(listingId: string): Promise<ListingExtras> {
  const [inquiryRows, viewRows, counterRows, audit] = await Promise.all([
    db
      .select({
        id: contacts.id,
        createdAt: contacts.createdAt,
        buyerName: contacts.buyerName,
        buyerEmail: contacts.buyerEmail,
        buyerPhone: contacts.buyerPhone,
        message: contacts.message,
      })
      .from(contacts)
      .where(eq(contacts.listingId, listingId))
      .orderBy(desc(contacts.createdAt))
      .limit(RECENT_INQUIRY_LIMIT),
    // countDistinct, not count: listing_views holds one row per (listing, viewer,
    // calendar day), so a plain row count would report a returning viewer twice and
    // make `distinct_viewers` a lie.
    db
      .select({ n: countDistinct(listingViews.viewerId) })
      .from(listingViews)
      .where(eq(listingViews.listingId, listingId)),
    db.select({ n: listings.viewCount }).from(listings).where(eq(listings.id, listingId)).limit(1),
    // Includes mcp.read rows deliberately: on one listing the volume is small and
    // "which MCP session looked at this" is exactly what an investigation wants.
    listAuditLog({
      targetType: "listing",
      targetId: listingId,
      includeReads: true,
      limit: AUDIT_HISTORY_LIMIT,
    }),
  ])

  return {
    recent_inquiries: inquiryRows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      buyer_name: r.buyerName,
      buyer_email: r.buyerEmail,
      buyer_phone: r.buyerPhone,
      message: r.message,
    })),
    views: {
      counter: counterRows[0]?.n ?? 0,
      distinct_viewers: viewRows[0]?.n ?? 0,
    },
    audit_history: audit.items,
  }
}
