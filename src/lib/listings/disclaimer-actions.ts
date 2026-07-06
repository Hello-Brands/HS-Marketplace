"use server"

import { auth } from "@/auth"
import { db } from "@/db"
import { listingDisclaimerAcknowledgments } from "@/db/schema"

// Version of the disclaimer/FDD the seller is acknowledging. Bump deliberately
// when the fee terms change so the audit log records which version applied.
export const FDD_VERSION = "2026"

/**
 * Record that the current seller acknowledged the "Selling Your Franchise"
 * disclaimer on the add-listing gate. One append-only audit row per call.
 *
 * Requires an authenticated session (same bar as the /seller/listings/new page;
 * NOT the stricter sellerAccess check — the listing-creation actions enforce
 * that downstream). Throws on no session or DB error so the gate can withhold
 * the wizard until the acknowledgment is durably recorded.
 */
export async function acknowledgeSellingDisclaimer(): Promise<{ ok: true }> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Error("Not authenticated")
  }

  await db.insert(listingDisclaimerAcknowledgments).values({
    userId: session.user.id,
    fddVersion: FDD_VERSION,
  })

  return { ok: true }
}
