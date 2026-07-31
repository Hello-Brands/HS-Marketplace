import Link from "next/link"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import {
  BRAND_REQUEST_STATUSES,
  brandRequests,
  type BrandRequestStatus,
} from "@/db/schema/brandRequests"
import { requireAdmin } from "@/lib/auth-guards"
import { BrandRequestsTable } from "@/components/admin/BrandRequestsTable"
import { desc, eq } from "drizzle-orm"

export const metadata = {
  title: "Brand Requests - Admin",
}

/**
 * Rows here are updated OUT OF BAND by the external competitor-monitor repo
 * (status transitions, recon, error), so this queue must never be cached —
 * see the header comment on the brandRequests schema.
 */
export const dynamic = "force-dynamic"

/** Pipeline-stage labels, matching RequestStatusBadge's admin label set. */
const STATUS_FILTERS: { value: BrandRequestStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "live", label: "Live" },
  { value: "needs_human", label: "Needs human" },
]

function parseStatus(value: string | undefined): BrandRequestStatus | undefined {
  return BRAND_REQUEST_STATUSES.includes(value as BrandRequestStatus)
    ? (value as BrandRequestStatus)
    : undefined
}

export default async function AdminBrandRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  // Admin access is enforced by src/app/admin/layout.tsx and again here.
  await requireAdmin()

  const { status } = await searchParams
  const statusFilter = parseStatus(status)

  // brandRequests has no drizzle relations defined, so the submitter comes from
  // an explicit leftJoin rather than db.query(...).with.
  const requests = await db
    .select({
      id: brandRequests.id,
      brandName: brandRequests.brandName,
      normalizedDomain: brandRequests.normalizedDomain,
      status: brandRequests.status,
      recon: brandRequests.recon,
      locationsFound: brandRequests.locationsFound,
      error: brandRequests.error,
      createdAt: brandRequests.createdAt,
      submitterName: users.name,
      submitterEmail: users.email,
    })
    .from(brandRequests)
    .leftJoin(users, eq(brandRequests.submittedBy, users.id))
    .where(statusFilter ? eq(brandRequests.status, statusFilter) : undefined)
    .orderBy(desc(brandRequests.createdAt))

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-y-2">
        <h1 className="min-w-0 font-display text-2xl font-bold text-gray-900">
          Brand Requests
        </h1>
        <span className="text-sm text-gray-500">
          {requests.length} request{requests.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Status filter tabs */}
      <div className="mb-6 flex gap-2 overflow-x-auto">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={
              filter.value
                ? `/admin/brand-requests?status=${filter.value}`
                : "/admin/brand-requests"
            }
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${
              (statusFilter ?? "") === filter.value
                ? "bg-hs-red-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      {requests.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-12 text-center">
          <p className="text-gray-500">No brand requests found.</p>
        </div>
      ) : (
        <BrandRequestsTable requests={requests} />
      )}
    </div>
  )
}
