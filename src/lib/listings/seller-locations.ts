"use server"

import { getMyOwnerLocations } from "@/lib/owner-directory/data"
import { getNetSalesByLocation, getMcrByLocation } from "@/lib/bigquery/queries"
import type { OwnerLocation } from "@/db/schema"
import type { LocationSelection } from "./types"

/**
 * Maps an owner-directory row to the wizard's location shape. The directory only
 * carries name/address + open/close dates; city, state, zip, sq ft and
 * coordinates are not stored there and are filled in later (geocoding for coords;
 * admin Data Mappings for the confirmed join), so we leave them undefined here.
 *
 * TTM revenue and MCR are the financial KPIs and live only in BigQuery. We look
 * them up here — server-side — keyed on the row's already-resolved
 * `resolvedBqLocationName`, so the wizard's "Verified data" panel shows the same
 * numbers as the published listing card instead of $0 / 0%.
 *
 * Note: the BigQuery join key is deliberately NOT carried through the client. It
 * is re-derived server-side at save time (see insertLocations) from this same
 * directory, so a seller can't attach another location's financials.
 */
function toLocationSelection(
  ol: OwnerLocation,
  netSales: Map<string, { totalCents: number }>,
  mcrPctByName: Map<string, number>,
): LocationSelection {
  const bqName = ol.resolvedBqLocationName
  const ns = bqName ? netSales.get(bqName) : undefined
  const mcrPct = bqName ? mcrPctByName.get(bqName) : undefined
  return {
    id: ol.id,
    type: "salon",
    externalId: ol.blvdLocationNumber ?? undefined,
    name: ol.blvdLocationName,
    address: ol.locationAddress ?? undefined,
    openingDate: ol.actualFlagshipGoDate ?? ol.actualSuiteGoDate ?? undefined,
    // totalCents is already in cents (the wizard divides by 100 to display).
    ttmRevenue: ns?.totalCents,
    // BigQuery returns MCR as a percentage (e.g. 34.5); the wizard stores/displays
    // it as a fraction (multiplies by 100), so convert here.
    mcr: mcrPct !== undefined ? mcrPct / 100 : undefined,
  }
}

/**
 * The logged-in owner's locations, for the new-listing picker. Session-scoped:
 * the owner is resolved server-side from the session (the userId arg is ignored
 * and kept only for the existing call site). Returns an empty list when the user
 * isn't a linked owner.
 *
 * TTM revenue and MCR are joined in from BigQuery (cached maps, same source as
 * the listing card). A location missing a resolved BigQuery name — or absent from
 * the maps — simply comes back without those fields, and the wizard hides them.
 */
export async function getSellerLocations(
  _userId?: string,
): Promise<LocationSelection[]> {
  void _userId
  const [{ locations }, netSales, mcrPctByName] = await Promise.all([
    getMyOwnerLocations(),
    getNetSalesByLocation(),
    getMcrByLocation(),
  ])
  return locations.map((ol) => toLocationSelection(ol, netSales, mcrPctByName))
}
