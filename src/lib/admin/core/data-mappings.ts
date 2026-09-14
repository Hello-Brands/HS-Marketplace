/**
 * BigQuery data-mapping core — shared by src/lib/data/mapping-actions.ts and
 * the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. Takes a trusted
 * `AdminActor`; does NOT check auth. Do not re-export from a `"use server"`
 * module and do not add `"use server"` here.
 */
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { getMondayCoordsByLocationNumber } from "@/lib/bigquery/queries"
import { mondayCoordsForBqName } from "@/lib/owner-directory/monday-coords"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

export type LocationMappingInput = {
  bqLocationName: string | null
  status: "confirmed" | "not_connected"
}

export async function setLocationMapping(
  actor: AdminActor,
  locationId: string,
  input: LocationMappingInput,
) {
  const { result, auditId } = await withAudit(
    actor,
    "listing_location.set_data_mapping",
    { type: "listing_location", id: locationId },
    { locationId, ...input },
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
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
    },
  )
  return { ...result, auditId }
}
