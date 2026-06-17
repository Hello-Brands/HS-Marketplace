"use server"

import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"

export async function setLocationMapping(
  locationId: string,
  input: { boulevardLocationId: string | null; status: "confirmed" | "not_connected" }
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return { ok: false, error: "Admin access required" }
  }
  if (input.status === "confirmed" && !input.boulevardLocationId) {
    return { ok: false, error: "A Boulevard location is required to confirm." }
  }
  await db
    .update(listingLocations)
    .set({ boulevardLocationId: input.boulevardLocationId, boulevardMappingStatus: input.status })
    .where(eq(listingLocations.id, locationId))
  return { ok: true }
}
