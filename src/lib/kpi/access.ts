/** Safety invariant: real live dollars/metrics only for listed + confirmed-mapped locations. */
export function canFetchLiveData(listingStatus: string, mappingStatus: string): boolean {
  return listingStatus === "active" && mappingStatus === "confirmed"
}
