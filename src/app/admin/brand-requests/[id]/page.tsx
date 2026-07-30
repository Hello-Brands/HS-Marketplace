import Link from "next/link"
import { notFound } from "next/navigation"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { brandRequests, type BrandRequestStatus } from "@/db/schema/brandRequests"
import { requireAdmin } from "@/lib/auth-guards"
import { RequestStatusBadge } from "@/components/brand-requests/RequestStatusBadge"
import { BrandRequestActions } from "@/components/admin/BrandRequestActions"
import { AutoRefresh } from "@/components/admin/AutoRefresh"
import { eq, inArray } from "drizzle-orm"

export const metadata = {
  title: "Brand Request - Admin",
}

/**
 * Rows here are updated OUT OF BAND by the external competitor-monitor repo
 * (status transitions, recon, error), so this page must never be cached —
 * see the header comment on the brandRequests schema.
 */
export const dynamic = "force-dynamic"

/** Statuses where the monitor pipeline is still expected to move on its own. */
const IN_FLIGHT_STATUSES: BrandRequestStatus[] = [
  "submitted",
  "recon_running",
  "approved",
  "building",
]

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Denver",
})

// Not formatUsdCents: that helper takes integer cents and rounds to whole
// dollars, while recon.estMonthlyCost is a dollar amount that can be a few
// cents' worth of API spend.
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-gray-900">{children}</dd>
    </div>
  )
}

export default async function AdminBrandRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Admin access is enforced by src/app/admin/layout.tsx and again here.
  await requireAdmin()

  const { id } = await params

  const request = await db.query.brandRequests.findFirst({
    where: eq(brandRequests.id, id),
  })
  if (!request) notFound()

  // brandRequests has no drizzle relations, and the submitter/decider are two
  // references to the same table — one lookup covers both.
  const peopleIds = [request.submittedBy, request.decidedBy].filter(
    (value): value is string => !!value,
  )
  const people = peopleIds.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, peopleIds))
    : []
  const submitter = people.find((p) => p.id === request.submittedBy) ?? null
  const decider = people.find((p) => p.id === request.decidedBy) ?? null

  const recon = request.recon ?? null
  const blockers = recon?.blockers?.filter(Boolean) ?? []
  const sampleLocations = recon?.sampleLocations?.filter(Boolean) ?? []
  const hasReconFields =
    !!recon &&
    (typeof recon.estLocationCount === "number" ||
      typeof recon.estMonthlyCost === "number" ||
      !!recon.strategy ||
      !!recon.confidence ||
      blockers.length > 0 ||
      sampleLocations.length > 0)

  return (
    <div>
      {IN_FLIGHT_STATUSES.includes(request.status) && <AutoRefresh />}

      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/admin/brand-requests"
          className="text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Brand Requests
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-y-2">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-bold text-gray-900">
              {request.brandName}
            </h1>
            <RequestStatusBadge
              status={request.status}
              audience="admin"
              size="md"
            />
          </div>
          <p className="text-gray-500">
            Requested by {submitter?.name || submitter?.email || "Unknown"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {request.error && (
            <div className="rounded-xl border border-hs-red-200 bg-hs-red-50 p-4">
              <h3 className="mb-1 font-medium text-hs-red-800">
                Pipeline error
              </h3>
              <p className="whitespace-pre-wrap break-words text-sm text-hs-red-700">
                {request.error}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-medium text-gray-900">Submission</h3>
            <dl className="divide-y divide-gray-100">
              <Row label="Brand">{request.brandName}</Row>
              <Row label="Website">
                <a
                  href={request.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-hs-red-600 hover:text-hs-red-700 hover:underline"
                >
                  {request.websiteUrl}
                </a>
              </Row>
              <Row label="Normalized domain">{request.normalizedDomain}</Row>
              <Row label="Known city / state">
                {request.knownCityState || "—"}
              </Row>
              <Row label="Submitted">{DATE_TIME.format(request.createdAt)}</Row>
            </dl>

            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-sm text-gray-500">
                Where have you seen them?
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                {request.note || "—"}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-medium text-gray-900">Recon</h3>

            {!hasReconFields ? (
              <p className="text-sm text-gray-500">
                {request.status === "submitted" || request.status === "recon_running"
                  ? "Recon in progress…"
                  : "No recon data."}
              </p>
            ) : (
              <>
                <dl className="divide-y divide-gray-100">
                  {typeof recon?.estLocationCount === "number" && (
                    <Row label="Est. location count">
                      {recon.estLocationCount.toLocaleString()}
                    </Row>
                  )}
                  {typeof recon?.estMonthlyCost === "number" && (
                    <Row label="Est. monthly cost">
                      {USD.format(recon.estMonthlyCost)}
                    </Row>
                  )}
                  {recon?.strategy && <Row label="Strategy">{recon.strategy}</Row>}
                  {recon?.confidence && (
                    <Row label="Confidence">{recon.confidence}</Row>
                  )}
                </dl>

                {blockers.length > 0 && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <p className="mb-2 text-sm text-gray-500">Blockers</p>
                    <ul className="list-inside list-disc space-y-1 text-sm text-amber-800">
                      {blockers.map((blocker, i) => (
                        <li key={`${blocker}-${i}`}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {sampleLocations.length > 0 && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <p className="mb-2 text-sm text-gray-500">Sample locations</p>
                    <ul className="space-y-1 text-sm text-gray-900">
                      {sampleLocations.map((location, i) => (
                        <li key={`${location}-${i}`}>{location}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-medium text-gray-900">Decision</h3>
            <BrandRequestActions
              requestId={request.id}
              status={request.status}
              hasError={!!request.error}
            />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-medium text-gray-900">Status</h3>
            <RequestStatusBadge
              status={request.status}
              audience="admin"
              size="md"
            />
            <dl className="mt-3 divide-y divide-gray-100">
              <Row label="Created">{DATE_TIME.format(request.createdAt)}</Row>
              <Row label="Updated">{DATE_TIME.format(request.updatedAt)}</Row>
            </dl>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-medium text-gray-900">Submitter</h3>
            <p className="text-sm font-medium text-gray-900">
              {submitter?.name || "Unknown"}
            </p>
            <p className="break-all text-sm text-gray-500">
              {submitter?.email || "—"}
            </p>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-medium text-gray-900">Decision</h3>
            {request.decidedAt ? (
              <dl className="divide-y divide-gray-100">
                <Row label="Decided by">
                  {decider?.name || decider?.email || "Unknown"}
                </Row>
                <Row label="Decided">{DATE_TIME.format(request.decidedAt)}</Row>
              </dl>
            ) : (
              <p className="text-sm text-gray-500">No decision yet.</p>
            )}
            {request.status === "rejected" && request.rejectReason && (
              <div className="mt-3 rounded-lg border border-hs-red-200 bg-hs-red-50 p-3">
                <p className="mb-1 text-xs font-medium uppercase text-hs-red-800">
                  Rejection reason
                </p>
                <p className="whitespace-pre-wrap text-sm text-hs-red-700">
                  {request.rejectReason}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 font-medium text-gray-900">Pipeline</h3>
            <dl className="divide-y divide-gray-100">
              <Row label="Brand ID">
                {request.brandId ? (
                  <span className="break-all font-mono text-xs">
                    {request.brandId}
                  </span>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Locations found">
                {request.locationsFound ?? "—"}
              </Row>
              <Row label="Build PR">
                {request.prUrl ? (
                  <a
                    href={request.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hs-red-600 hover:text-hs-red-700 hover:underline"
                  >
                    View PR
                  </a>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Issue">
                {request.issueUrl ? (
                  <a
                    href={request.issueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hs-red-600 hover:text-hs-red-700 hover:underline"
                  >
                    View issue
                  </a>
                ) : (
                  "—"
                )}
              </Row>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
