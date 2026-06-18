import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { listLocationNames } from "@/lib/bigquery/queries"
import { suggestLocationMatch } from "@/lib/data/match"
import { DataMappings } from "@/components/admin/DataMappings"

export default async function AdminDataPage() {
  const session = await auth()

  if (!session?.user?.id || session.user.role !== "admin") {
    redirect("/")
  }

  const [locations, names] = await Promise.all([
    db.query.listingLocations.findMany({
      where: eq(listingLocations.locationType, "salon"),
      with: { listing: { columns: { id: true, title: true, status: true } } },
    }),
    listLocationNames(),
  ])

  const candidates = (names ?? []).map((n) => ({ id: n, name: n }))
  const rows = locations.map((loc) => {
    const suggestion = names ? suggestLocationMatch(loc.name, candidates) : null
    return {
      locationId: loc.id,
      locationName: loc.name,
      listingId: loc.listing?.id ?? null,
      listingTitle: loc.listing?.title ?? null,
      listingStatus: loc.listing?.status ?? null,
      status: loc.dataMappingStatus,
      currentLocationName: loc.bqLocationName,
      suggestedId: suggestion?.id ?? null,
      suggestedConfidence: suggestion?.confidence ?? null,
    }
  })

  return (
    <DataMappings
      rows={rows}
      locationNames={names ?? []}
      bqConfigured={names !== null}
    />
  )
}
