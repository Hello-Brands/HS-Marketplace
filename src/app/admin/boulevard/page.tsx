import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { db } from "@/db"
import { listingLocations } from "@/db/schema/listings"
import { eq } from "drizzle-orm"
import { listBoulevardLocations } from "@/lib/boulevard/client"
import { suggestBoulevardMatch } from "@/lib/boulevard/match"
import { BoulevardMappings } from "@/components/admin/BoulevardMappings"

export default async function AdminBoulevardPage() {
  const session = await auth()

  if (!session?.user?.id || session.user.role !== "admin") {
    redirect("/")
  }

  const [locations, blvd] = await Promise.all([
    db.query.listingLocations.findMany({
      where: eq(listingLocations.locationType, "salon"),
      with: { listing: { columns: { id: true, title: true, status: true } } },
    }),
    listBoulevardLocations(),
  ])

  const rows = locations.map((loc) => {
    const suggestion = blvd ? suggestBoulevardMatch(loc.name, blvd) : null
    return {
      locationId: loc.id,
      locationName: loc.name,
      listingId: loc.listing?.id ?? null,
      listingTitle: loc.listing?.title ?? null,
      listingStatus: loc.listing?.status ?? null,
      status: loc.boulevardMappingStatus,
      currentBoulevardId: loc.boulevardLocationId,
      suggestedId: suggestion?.id ?? null,
      suggestedConfidence: suggestion?.confidence ?? null,
    }
  })

  return (
    <BoulevardMappings
      rows={rows}
      blvdLocations={blvd ?? []}
      blvdConfigured={blvd !== null}
    />
  )
}
