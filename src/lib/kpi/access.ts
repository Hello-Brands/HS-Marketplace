/** The Rock 2 safety invariant: real Boulevard dollars only for listed + confirmed-mapped locations. */
export function canFetchBoulevard(listingStatus: string, mappingStatus: string): boolean {
  return listingStatus === "active" && mappingStatus === "confirmed"
}
