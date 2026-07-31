"use server"

import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { getMondayCoordsByLocationNumber } from "@/lib/bigquery/queries"
import { mondayCoordsForBqName } from "@/lib/owner-directory/monday-coords"

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

  // Monday is the coordinate source of truth: stamp coords the moment a
  // mapping is confirmed rather than waiting for the next directory sync.
  // Best-effort — a BigQuery failure degrades to confirming without coords.
  let coordFields: {
    latitude?: number
    longitude?: number
    geocodedAt?: Date
    geocodeSource?: string
  } = {}
  if (input.status === "confirmed" && input.bqLocationName) {
    try {
      const coords = await getMondayCoordsByLocationNumber()
      const hit = coords ? await mondayCoordsForBqName(input.bqLocationName, coords) : null
      if (hit) {
        coordFields = {
          latitude: hit.lat,
          longitude: hit.lng,
          geocodedAt: new Date(),
          geocodeSource: "monday",
        }
      }
    } catch (err) {
      console.warn("[data-mapping] Monday coords lookup failed — mapping saved without coords", err)
    }
  }

  await db
    .update(listingLocations)
    .set({ bqLocationName: input.bqLocationName, dataMappingStatus: input.status, ...coordFields })
    .where(eq(listingLocations.id, locationId))
  return { ok: true }
}
