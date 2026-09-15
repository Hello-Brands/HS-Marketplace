// Salon locations whose data-source mapping still blocks listing approval.
//
// NOT a use server module.
//
// Mirrors src/app/admin/data/page.tsx exactly, including its BigQuery degradation:
// listLocationNames() returns null when BigQuery is not configured or unreachable,
// and the page then renders the rows with no suggestions rather than failing. The
// tool reports that state as `bq_configured: false` so the model does not mistake
// "no suggestion" for "no match exists".
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { listLocationNames } from "@/lib/bigquery/queries"
import { suggestLocationMatch } from "@/lib/data/match"
import { unresolvedSalonLocations } from "@/lib/data/mapping"

export interface UnresolvedMapping {
  location_id: string
  location_name: string
  listing: { id: string; title: string | null; status: string } | null
  status: string
  current_bq_location_name: string | null
  suggestion: { bq_location_name: string; confidence: number } | null
}

export async function unresolvedMappings(): Promise<{
  items: UnresolvedMapping[]
  bq_configured: boolean
}> {
  const [locations, names] = await Promise.all([
    db.query.listingLocations.findMany({
      where: eq(listingLocations.locationType, "salon"),
      with: { listing: { columns: { id: true, title: true, status: true } } },
    }),
    listLocationNames(),
  ])

  const candidates = (names ?? []).map((n) => ({ id: n, name: n }))
  const blocking = unresolvedSalonLocations(
    locations.map((loc) => ({
      id: loc.id,
      name: loc.name,
      locationType: loc.locationType,
      dataMappingStatus: loc.dataMappingStatus,
    })),
  )
  const blockingIds = new Set(blocking.map((b) => b.id))

  return {
    items: locations
      .filter((loc) => blockingIds.has(loc.id))
      .map((loc) => {
        const suggestion = names ? suggestLocationMatch(loc.name, candidates) : null
        return {
          location_id: loc.id,
          location_name: loc.name,
          listing: loc.listing
            ? { id: loc.listing.id, title: loc.listing.title, status: loc.listing.status }
            : null,
          status: loc.dataMappingStatus,
          current_bq_location_name: loc.bqLocationName,
          suggestion: suggestion
            ? { bq_location_name: suggestion.name, confidence: suggestion.confidence }
            : null,
        }
      }),
    bq_configured: names !== null,
  }
}
