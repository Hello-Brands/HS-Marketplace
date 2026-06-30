"use server"

import { getMyOwnerLocations } from "@/lib/owner-directory/data"
import type { OwnerLocation } from "@/db/schema"
import type { LocationSelection } from "./types"

/**
 * Maps an owner-directory row to the wizard's location shape. The directory only
 * carries name/address + open/close dates; city, state, zip, sq ft, TTM revenue,
 * MCR and coordinates are not stored there. They are filled in later (geocoding
 * for coords; admin Data Mappings + BigQuery for the financial KPIs), so we leave
 * them undefined here.
 *
 * Note: the BigQuery join key is deliberately NOT carried through the client. It
 * is re-derived server-side at save time (see insertLocations) from this same
 * directory, so a seller can't attach another location's financials.
 */
function toLocationSelection(ol: OwnerLocation): LocationSelection {
  return {
    id: ol.id,
    type: "salon",
    externalId: ol.blvdLocationNumber ?? undefined,
    name: ol.blvdLocationName,
    address: ol.locationAddress ?? undefined,
    openingDate: ol.actualFlagshipGoDate ?? ol.actualSuiteGoDate ?? undefined,
  }
}

/**
 * The logged-in owner's locations, for the new-listing picker. Session-scoped:
 * the owner is resolved server-side from the session (the userId arg is ignored
 * and kept only for the existing call site). Returns an empty list when the user
 * isn't a linked owner.
 */
export async function getSellerLocations(
  _userId?: string,
): Promise<LocationSelection[]> {
  void _userId
  const { locations } = await getMyOwnerLocations()
  return locations.map(toLocationSelection)
}
