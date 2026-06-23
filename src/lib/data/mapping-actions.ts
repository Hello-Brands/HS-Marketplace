"use server"

import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"

export async function setLocationMapping(
  locationId: string,
  input: { bqLocationName: string | null; status: "confirmed" | "not_connected" }
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    return { ok: false, error: "Admin access required" }
  }
  if (input.status === "confirmed" && !input.bqLocationName) {
    return { ok: false, error: "A location is required to confirm." }
  }
  await db
    .update(listingLocations)
    .set({ bqLocationName: input.bqLocationName, dataMappingStatus: input.status })
    .where(eq(listingLocations.id, locationId))
  return { ok: true }
}
