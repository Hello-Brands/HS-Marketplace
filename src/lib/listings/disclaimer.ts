import { and, eq } from "drizzle-orm"
import { db } from "@/db"
import { listingDisclaimerAcknowledgments } from "@/db/schema"
import { FDD_VERSION } from "./fdd"

/**
 * Server-side check that a user has a durable acknowledgment row for the current
 * FDD version. The client gate reveals the wizard optimistically, but the
 * listing-create path must independently verify this so a seller cannot create a
 * listing by calling the create action directly, bypassing the gate (DEBT-022).
 *
 * Deliberately NOT in the `"use server"` module: this is an internal query the
 * create action calls with the session's own user id, not a client-callable
 * server action (which would let a caller probe arbitrary user ids).
 */
export async function hasAcknowledgedCurrentFdd(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: listingDisclaimerAcknowledgments.id })
    .from(listingDisclaimerAcknowledgments)
    .where(
      and(
        eq(listingDisclaimerAcknowledgments.userId, userId),
        eq(listingDisclaimerAcknowledgments.fddVersion, FDD_VERSION),
      ),
    )
    .limit(1)

  return row !== undefined
}
