/** Safety invariant: real live dollars/metrics only for listed + confirmed-mapped locations. */
export function canFetchLiveData(listingStatus: string, mappingStatus: string): boolean {
  return listingStatus === "active" && mappingStatus === "confirmed"
}

/**
 * Owner-scoped variant (parallel to the listing gate above, which is
 * unchanged): a linked owner may see live data for an owner_locations row
 * they own that has a resolved BigQuery name. The row must come from a
 * server-side owner-scoped query — never trust client-supplied identifiers.
 */
export function canOwnerFetchLiveData(
  rowOwnerIdentifier: string,
  sessionOwnerIdentifier: string | null | undefined,
  resolvedBqLocationName: string | null
): boolean {
  return (
    !!sessionOwnerIdentifier &&
    rowOwnerIdentifier === sessionOwnerIdentifier &&
    !!resolvedBqLocationName
  )
}
