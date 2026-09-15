// src/lib/admin/core/inquiries.ts
/**
 * Admin inquiry read model — shared by src/app/admin/inquiries/actions.ts and
 * the MCP read tools. NOT a `"use server"` file; does not check auth.
 */
import { db } from "@/db"
import { contacts } from "@/db/schema/contacts"
import { listings, listingLocations } from "@/db/schema/listings"
import { users } from "@/db/schema/auth"
import { eq, desc } from "drizzle-orm"

export async function getInquiries(opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 100
  return db
    .select({
      id: contacts.id,
      message: contacts.message,
      buyerName: contacts.buyerName,
      buyerEmail: contacts.buyerEmail,
      buyerPhone: contacts.buyerPhone,
      createdAt: contacts.createdAt,
      listingId: contacts.listingId,
      listingTitle: listings.title,
      listingLocationName: listingLocations.name,
      listingCity: listingLocations.city,
      listingState: listingLocations.state,
      sellerName: users.name,
      sellerEmail: users.email,
    })
    .from(contacts)
    .innerJoin(listings, eq(contacts.listingId, listings.id))
    .innerJoin(users, eq(listings.sellerId, users.id))
    .leftJoin(listingLocations, eq(listingLocations.listingId, listings.id))
    .orderBy(desc(contacts.createdAt))
    .limit(limit)
}
