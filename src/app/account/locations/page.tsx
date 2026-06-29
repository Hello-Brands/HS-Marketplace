import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getMyOwnerLocations } from "@/lib/owner-directory/data"
import { deriveLocationStatus, type OverallStatus } from "@/lib/owner-directory/status"
import { Badge } from "@/components/ui/Badge"
import { SiteHeader } from "@/components/layout/SiteHeader"
import { EmptyStateIllustrated } from "@/components/ui/EmptyState"

export const metadata = {
  title: "My Locations - Hello Sugar Marketplace",
}

const STATUS_VARIANT: Record<OverallStatus, "success" | "default" | "warning"> = {
  active: "success",
  closed: "default",
  pending: "warning",
}

export default async function MyLocationsPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  const { ownerIdentifier, locations } = await getMyOwnerLocations()

  return (
    <>
      <SiteHeader
        world="marketplace"
        title="My Locations"
        subtitle={
          ownerIdentifier
            ? `${locations.length} location${locations.length !== 1 ? "s" : ""} owned by you`
            : "Locations linked to your owner account"
        }
      />
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {!ownerIdentifier || locations.length === 0 ? (
        <EmptyStateIllustrated
          title="No owned locations linked yet"
          description="We link your locations automatically from the Hello Sugar owner directory using your sign-in email. If you own locations but don't see them, an admin can link your account manually."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {locations.map((loc) => {
            const status = deriveLocationStatus(loc)
            const connected = loc.resolvedBqLocationName !== null
            return (
              <div
                key={loc.id}
                className="flex flex-col gap-3 p-4 bg-white rounded-xl border border-gray-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-gray-900">{loc.blvdLocationName}</p>
                    {loc.locationAddress && (
                      <p className="text-sm text-gray-500 mt-0.5">{loc.locationAddress}</p>
                    )}
                  </div>
                  <Badge variant={STATUS_VARIANT[status.overall]} dot>
                    {status.label}
                  </Badge>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  {connected ? (
                    <Badge variant="info" size="sm">Connected to financials</Badge>
                  ) : (
                    <Badge variant="outline" size="sm">Not yet connected</Badge>
                  )}
                  {loc.blvdLocationNumber && (
                    <span className="text-xs text-gray-400">#{loc.blvdLocationNumber}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      </div>
    </>
  )
}
