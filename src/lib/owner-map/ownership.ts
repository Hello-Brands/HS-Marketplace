/**
 * Pure ownership matching for the /browse map "your locations" highlight.
 * Server code computes these per-request from the session; the shared map
 * caches stay owner-agnostic (DEBT-024), so nothing here touches the DB.
 */

/** ID sets handed to the client to mark map dots as "yours". */
export interface MapOwnership {
  ownedListingIds: string[]
  ownedHsLocationIds: string[]
}

export const EMPTY_MAP_OWNERSHIP: MapOwnership = {
  ownedListingIds: [],
  ownedHsLocationIds: [],
}

/** One row per (active listing × location) from the browse ownership query. */
export interface ListingOwnershipRow {
  listingId: string
  sellerId: string
  bqLocationName: string | null
  dataMappingStatus: string | null
}

/** The owner's financial join keys — non-null resolved BigQuery names. */
export function ownedBqNameSet(
  locations: { resolvedBqLocationName: string | null }[]
): Set<string> {
  return new Set(
    locations
      .map((l) => l.resolvedBqLocationName)
      .filter((n): n is string => n !== null)
  )
}

/**
 * A listing is "mine" if I am its seller, or any of its locations has a
 * CONFIRMED mapping to a BigQuery name I own (unconfirmed suggestions are
 * name-match guesses and must not drive ownership).
 */
export function computeOwnedListingIds(
  rows: ListingOwnershipRow[],
  userId: string,
  ownedBqNames: Set<string>
): string[] {
  const owned = new Set<string>()
  for (const r of rows) {
    if (r.sellerId === userId) {
      owned.add(r.listingId)
      continue
    }
    if (
      r.bqLocationName &&
      r.dataMappingStatus === "confirmed" &&
      ownedBqNames.has(r.bqLocationName)
    ) {
      owned.add(r.listingId)
    }
  }
  return [...owned]
}
