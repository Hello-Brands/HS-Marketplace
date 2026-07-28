import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { getMyOwnerLocationById } from "@/lib/owner-directory/my-location"
import { deriveLocationStatus, type OverallStatus } from "@/lib/owner-directory/status"
import { openedSinceYear } from "@/lib/hs-locations-filter"
import { fetchOwnerLocationKpis } from "@/lib/kpi/fetch"
import { LocationKpiCards } from "@/components/kpi/LocationKpiCards"
import { LocationReviewsPanel } from "@/components/kpi/LocationReviewsPanel"
import { Badge } from "@/components/ui/Badge"
import { SiteHeader } from "@/components/layout/SiteHeader"

export const metadata = {
  title: "Location Details - Hello Sugar Marketplace",
}

const STATUS_VARIANT: Record<OverallStatus, "success" | "default" | "warning"> = {
  active: "success",
  closed: "default",
  pending: "warning",
}

export default async function OwnerLocationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  // Owner gate: the lookup is scoped to the signed-in user's owner_identifier,
  // so any other user's location id (or an unknown id) 404s here.
  const loc = await getMyOwnerLocationById(id)
  if (!loc) {
    notFound()
  }

  const status = deriveLocationStatus(loc)
  const connected = loc.resolvedBqLocationName !== null
  const openedSince = openedSinceYear(loc)

  const { netSales, membership, reviews } = await fetchOwnerLocationKpis({
    rowOwnerIdentifier: loc.ownerIdentifier,
    sessionOwnerIdentifiers: session.user.ownerIdentifiers ?? [],
    bqLocationName: loc.resolvedBqLocationName,
  })

  return (
    <>
      <SiteHeader world="marketplace" title={loc.blvdLocationName} subtitle="Your location" />
      <main className="max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-8 pb-tabbar">
        <Link
          href="/account/locations"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-hs-red-700 hover:text-hs-red-800"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          My Locations
        </Link>

        {/* Location details */}
        <section className="p-5 bg-white rounded-xl border border-gray-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-display font-semibold text-gray-900">
                {loc.blvdLocationName}
              </h1>
              {loc.locationAddress && (
                <p className="text-sm text-gray-500 mt-1">{loc.locationAddress}</p>
              )}
            </div>
            <Badge variant={STATUS_VARIANT[status.overall]} dot>
              {status.label}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-gray-100">
            {connected ? (
              <Badge variant="info" size="sm">Connected to financials</Badge>
            ) : (
              <Badge variant="outline" size="sm">Not yet connected</Badge>
            )}
            {loc.blvdLocationNumber && (
              <span className="text-xs text-gray-400">#{loc.blvdLocationNumber}</span>
            )}
            {openedSince != null && (
              <span className="text-xs text-gray-400">Open since {openedSince}</span>
            )}
          </div>
        </section>

        {/* Financials — same metrics the marketplace listing pages show */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Performance Data</h2>
          {connected ? (
            <>
              <LocationKpiCards netSales={netSales} membership={membership} />
              <LocationReviewsPanel reviews={reviews} />
            </>
          ) : (
            <p className="text-sm text-gray-500">
              This location isn&apos;t connected to financial data yet. An admin can
              connect it from the owner directory.
            </p>
          )}
        </section>
      </main>
    </>
  )
}
