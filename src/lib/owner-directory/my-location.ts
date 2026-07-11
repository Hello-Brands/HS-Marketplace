import "server-only"
import type { OwnerLocation } from "@/db/schema"
import { getMyOwnerLocations } from "./data"

/**
 * The owner_locations row ONLY if the signed-in user owns it, else null so
 * the caller can 404. Delegates to getMyOwnerLocations, which is query-scoped
 * to the session user's owner_identifier and never returns Unknown Owner —
 * so a mismatched id can never leak another owner's row.
 */
export async function getMyOwnerLocationById(id: string): Promise<OwnerLocation | null> {
  const { locations } = await getMyOwnerLocations()
  return locations.find((l) => l.id === id) ?? null
}
