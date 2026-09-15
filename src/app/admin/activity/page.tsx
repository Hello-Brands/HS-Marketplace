import Link from "next/link"
import { requireAdmin } from "@/lib/auth-guards"
import { getRecentActivity, ACTIVITY_KINDS, type ActivityKind } from "@/lib/admin/activity"
import { getUsers } from "@/lib/admin/core/users"

export const metadata = { title: "Activity - Admin" }

// The audit log and brand requests change out of band; never cache this page.
export const dynamic = "force-dynamic"

const KIND_LABELS: Record<ActivityKind, string> = {
  admin_action: "Admin actions",
  listing_created: "Listings created",
  listing_listed: "Listings went live",
  listing_updated: "Listings updated",
  inquiry: "Inquiries",
  favorite: "Saves",
  login: "Logins",
  brand_request_submitted: "Brand requests",
  brand_request_decided: "Brand decisions",
  owner_link_changed: "Owner links",
}

function parseKind(value: string | undefined): ActivityKind | undefined {
  return ACTIVITY_KINDS.includes(value as ActivityKind) ? (value as ActivityKind) : undefined
}

function targetHref(target: { type: string; id: string } | null): string | null {
  if (!target) return null
  switch (target.type) {
    case "listing":
      return `/admin/listings/${target.id}`
    case "user":
      return `/admin/analytics/${target.id}`
    case "brand_request":
      return `/admin/brand-requests/${target.id}`
    default:
      return null
  }
}

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; actor?: string; cursor?: string }>
}) {
  // Admin access is enforced by src/app/admin/layout.tsx and again here.
  await requireAdmin()

  const { kind, actor, cursor } = await searchParams
  const kindFilter = parseKind(kind)
  const actorFilter = actor || undefined

  const [{ items, nextCursor }, users] = await Promise.all([
    getRecentActivity({
      kinds: kindFilter ? [kindFilter] : undefined,
      actorUserId: actorFilter,
      cursor: cursor ?? null,
      limit: 50,
    }),
    getUsers(),
  ])

  const olderParams = new URLSearchParams()
  if (kindFilter) olderParams.set("kind", kindFilter)
  if (actorFilter) olderParams.set("actor", actorFilter)
  if (nextCursor) olderParams.set("cursor", nextCursor)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <h1 className="font-display text-2xl font-bold text-gray-900">Activity</h1>
        <span className="text-sm text-gray-500">Newest first</span>
      </div>

      <form method="get" className="flex flex-wrap gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Kind
          <select name="kind" defaultValue={kindFilter ?? ""} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">All</option>
            {ACTIVITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Actor
          <select name="actor" defaultValue={actorFilter ?? ""} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email || u.id}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white">
          Filter
        </button>
        <Link href="/admin/activity" className="self-center text-sm text-gray-500 underline">
          Reset
        </Link>
      </form>

      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
          No activity matches these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">When</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Kind</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">What happened</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {items.map((item) => {
                  const href = targetHref(item.target)
                  return (
                    <tr key={`${item.kind}-${item.id}`} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                        {item.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-700">{KIND_LABELS[item.kind]}</td>
                      <td className="px-6 py-3 text-sm text-gray-900">
                        {href ? (
                          <Link href={href} className="hover:underline">
                            {item.summary}
                          </Link>
                        ) : (
                          item.summary
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">{item.source === "mcp" ? "MCP" : item.source === "ui" ? "Web" : "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-end">
          <Link href={`/admin/activity?${olderParams.toString()}`} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
            Older →
          </Link>
        </div>
      )}
    </div>
  )
}
