import { auth } from "@/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { db } from "@/db"
import { brandRequests } from "@/db/schema/brandRequests"
import { desc, eq } from "drizzle-orm"
import { SiteHeader } from "@/components/layout/SiteHeader"
import { AutoRefresh } from "@/components/ui/AutoRefresh"
import { EmptyStateIllustrated } from "@/components/ui/EmptyState"
import { RequestStatusBadge } from "@/components/brand-requests/RequestStatusBadge"
import { MonitoredBrandsList } from "@/components/brand-requests/MonitoredBrandsList"
import { sortMonitoredBrands } from "@/lib/brand-requests/monitored-brands-display"

export const metadata = {
  title: "Brand Requests - Hello Sugar Marketplace",
}

/**
 * Rows here are updated OUT OF BAND by the external competitor-monitor repo
 * (status transitions, recon, error), so this page must never be cached —
 * see the header comment on the brandRequests schema.
 */
export const dynamic = "force-dynamic"

/** Bare domain for display: the stored websiteUrl is always a normalized URL. */
function displayDomain(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, "")
  } catch {
    return websiteUrl
  }
}

export default async function MyBrandRequestsPage() {
  const session = await auth()
  if (!session?.user?.id) {
    redirect("/login")
  }

  const requests = await db.query.brandRequests.findMany({
    where: eq(brandRequests.submittedBy, session.user.id),
    orderBy: [desc(brandRequests.createdAt)],
  })

  // monitored_brands is OWNED by the external competitor-monitor repo and is
  // read-only here; rows appear/change out of band, so it must not be cached
  // (covered by the page-level force-dynamic above).
  const monitored = sortMonitoredBrands(
    await db.query.monitoredBrands.findMany({
      columns: { brandId: true, name: true, locationsCount: true },
    }),
  )

  return (
    <>
      {/*
        Monitor writes (new brands, refreshed location counts) never come from a
        mutation on this page. Unlike the admin detail page there is no in-flight
        status to gate on, so this stays mounted and 60s — not the 10s default —
        is the deliberate mitigation for a whole-page RSC refresh.
      */}
      <AutoRefresh intervalMs={60_000} />
      <SiteHeader
        world="marketplace"
        title="Brand Requests"
        subtitle={`${requests.length} request${requests.length !== 1 ? "s" : ""}`}
      />
      <main className="max-w-3xl mx-auto px-4 py-6 sm:py-8 pb-tabbar">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">My requests</h2>
            <p className="text-sm text-gray-500 mt-1">
              Ask us to track a competitor brand you keep running into. We review each
              request before adding it.
            </p>
          </div>
          <Link
            href="/account/brand-requests/new"
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 transition-colors"
          >
            Request a brand
          </Link>
        </div>

        {requests.length === 0 ? (
          <EmptyStateIllustrated
            title="No brand requests yet"
            description="Seen a competitor opening near your locations? Request it and we'll start tracking their openings and closings for you."
            action={
              <Link
                href="/account/brand-requests/new"
                className="inline-flex items-center px-5 py-2.5 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 transition-colors"
              >
                Request your first brand
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {requests.map((request) => (
              <li
                key={request.id}
                className="flex flex-col gap-2 p-4 bg-white rounded-xl border border-gray-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-bold text-gray-900 truncate">
                      {request.brandName}
                    </p>
                    <p className="text-sm text-gray-500 truncate">
                      {displayDomain(request.websiteUrl)}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <RequestStatusBadge status={request.status} audience="user" />
                  </div>
                </div>

                <p className="text-xs text-gray-400">
                  Submitted{" "}
                  {new Date(request.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "America/Denver",
                  })}
                </p>

                {request.status === "rejected" && request.rejectReason && (
                  <p className="text-xs text-gray-500">
                    Reason: {request.rejectReason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 pt-6 border-t border-gray-200">
          <MonitoredBrandsList brands={monitored} />
        </div>
      </main>
    </>
  )
}
