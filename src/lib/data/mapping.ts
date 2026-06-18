export type MappableLocation = {
  id: string
  name: string
  locationType: string
  dataMappingStatus: string
}

/** Salon locations that still block approval (territory + already-resolved are exempt). */
export function unresolvedSalonLocations<T extends MappableLocation>(rows: T[]): T[] {
  return rows.filter(
    (r) => r.locationType === "salon" && r.dataMappingStatus === "unconfirmed"
  )
}
