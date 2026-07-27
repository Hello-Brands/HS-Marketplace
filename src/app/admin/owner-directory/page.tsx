import { getOwnerDirectory, listUsersWithLinks, listLinkableOwners } from "@/lib/owner-directory/data"
import { UNKNOWN_OWNER } from "@/lib/owner-directory/query"
import { OwnerDirectory } from "@/components/admin/OwnerDirectory"
import { countMultiLinkUsers } from "@/lib/owner-directory/admin-view"

export const metadata = {
  title: "Owner Directory - Admin",
}

// Admin access is enforced by src/app/admin/layout.tsx and again in each query.
export default async function OwnerDirectoryAdminPage() {
  const [rows, users, owners] = await Promise.all([
    getOwnerDirectory(),
    listUsersWithLinks(),
    listLinkableOwners(),
  ])

  const directory = rows.map((r) => ({
    id: r.id,
    ownerIdentifier: r.ownerIdentifier,
    ownerName: r.ownerName,
    ownerContactEmail: r.ownerContactEmail,
    blvdLocationName: r.blvdLocationName,
    blvdLocationNumber: r.blvdLocationNumber,
    resolvedBqLocationName: r.resolvedBqLocationName,
    blvdMatchMethod: r.blvdMatchMethod,
    blvdMatchConfidence: r.blvdMatchConfidence,
    isUnknown: r.ownerIdentifier === UNKNOWN_OWNER,
  }))

  return (
    <OwnerDirectory
      directory={directory}
      users={users}
      owners={owners}
      multiLinkCount={countMultiLinkUsers(users)}
    />
  )
}
