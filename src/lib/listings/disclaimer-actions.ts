"use server"

import { db } from "@/db"
import { listingDisclaimerAcknowledgments } from "@/db/schema"
import { FDD_VERSION } from "./fdd"
import { requireSession } from "@/lib/auth-guards"

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
  const user = await requireSession()

  await db.insert(listingDisclaimerAcknowledgments).values({
    userId: user.id!,
    fddVersion: FDD_VERSION,
  })

  return { ok: true }
}
