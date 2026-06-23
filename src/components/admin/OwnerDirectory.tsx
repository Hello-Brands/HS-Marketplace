"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import {
  refreshOwnerDirectory,
  manuallyLinkUser,
  manuallyUnlinkUser,
  resetUserLink,
} from "@/lib/owner-directory/actions"

type DirectoryRow = {
  id: string
  ownerIdentifier: string
  ownerName: string | null
  ownerContactEmail: string | null
  blvdLocationName: string
  blvdLocationNumber: string | null
  resolvedBqLocationName: string | null
  blvdMatchMethod: "number_exact" | "name_exact" | "name_fuzzy" | "unmatched"
  blvdMatchConfidence: "high" | "medium" | "low" | "none"
  isUnknown: boolean
}

type UserRow = {
  id: string
  name: string | null
  email: string | null
  ownerIdentifier: string | null
  ownerLinkSource: "auto" | "manual" | null
}

type Owner = { ownerIdentifier: string; ownerName: string | null }

const METHOD_VARIANT: Record<DirectoryRow["blvdMatchMethod"], "success" | "warning" | "default"> = {
  number_exact: "success",
  name_exact: "success",
  name_fuzzy: "warning",
  unmatched: "default",
}

export function OwnerDirectory({
  directory,
  users,
  owners,
}: {
  directory: DirectoryRow[]
  users: UserRow[]
  owners: Owner[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [pending, startTransition] = useTransition()
  const [notice, setNotice] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return directory
    return directory.filter((r) =>
      [r.ownerIdentifier, r.ownerName, r.ownerContactEmail, r.blvdLocationName]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    )
  }, [directory, search])

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setNotice(null)
    startTransition(async () => {
      const res = await fn()
      setNotice(res.ok ? ok : `Error: ${res.error ?? "failed"}`)
      router.refresh()
    })
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Owner Directory</h1>
          <p className="text-gray-500 mt-1">
            {directory.length} location rows · synced from BigQuery (read-only)
          </p>
        </div>
        <Button
          variant="primary"
          loading={pending}
          onClick={() =>
            run(async () => {
              const res = await refreshOwnerDirectory()
              return res.ok
                ? { ok: true }
                : { ok: false, error: res.error }
            }, "Directory refreshed")
          }
        >
          Refresh now
        </Button>
      </div>

      {notice && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            notice.startsWith("Error")
              ? "bg-hs-red-50 text-hs-red-800"
              : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {notice}
        </div>
      )}

      {/* Manual override panel */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Owner links (manual override)</h2>
        <p className="text-sm text-gray-500">
          Link a user whose sign-in email differs from their directory contact email. Manual
          links are never overwritten by the automatic match.
        </p>
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">User</th>
                <th className="text-left font-semibold px-4 py-2.5">Linked owner</th>
                <th className="text-left font-semibold px-4 py-2.5">Source</th>
                <th className="text-left font-semibold px-4 py-2.5">Override</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <UserLinkRow key={u.id} user={u} owners={owners} pending={pending} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Directory viewer */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-lg font-semibold text-gray-900">Directory</h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search owner, email, or location…"
            className="w-full sm:w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
          />
        </div>
        <p className="text-sm text-gray-500">{filtered.length} shown</p>
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Owner</th>
                <th className="text-left font-semibold px-4 py-2.5">Location</th>
                <th className="text-left font-semibold px-4 py-2.5">#</th>
                <th className="text-left font-semibold px-4 py-2.5">Resolved (BQ)</th>
                <th className="text-left font-semibold px-4 py-2.5">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <tr key={r.id} className={r.isUnknown ? "bg-amber-50/60" : undefined}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">
                      {r.ownerIdentifier}
                      {r.isUnknown && (
                        <Badge variant="warning" size="sm" className="ml-2">
                          Unknown
                        </Badge>
                      )}
                    </div>
                    <div className="text-gray-500">{r.ownerContactEmail || "—"}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-900">{r.blvdLocationName}</td>
                  <td className="px-4 py-2.5 text-gray-500">{r.blvdLocationNumber || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-700">{r.resolvedBqLocationName || "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={METHOD_VARIANT[r.blvdMatchMethod]} size="sm">
                      {r.blvdMatchMethod}
                      {r.blvdMatchConfidence !== "none" ? ` · ${r.blvdMatchConfidence}` : ""}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function UserLinkRow({
  user,
  owners,
  pending,
  run,
}: {
  user: UserRow
  owners: Owner[]
  pending: boolean
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void
}) {
  const [selected, setSelected] = useState(user.ownerIdentifier ?? "")

  return (
    <tr>
      <td className="px-4 py-2.5">
        <div className="font-medium text-gray-900">{user.name || "—"}</div>
        <div className="text-gray-500">{user.email}</div>
      </td>
      <td className="px-4 py-2.5 text-gray-900">{user.ownerIdentifier || "—"}</td>
      <td className="px-4 py-2.5">
        {user.ownerLinkSource ? (
          <Badge variant={user.ownerLinkSource === "manual" ? "primary" : "default"} size="sm">
            {user.ownerLinkSource}
          </Badge>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm max-w-[14rem]"
          >
            <option value="">Select owner…</option>
            {owners.map((o) => (
              <option key={o.ownerIdentifier} value={o.ownerIdentifier}>
                {o.ownerIdentifier}
                {o.ownerName ? ` (${o.ownerName})` : ""}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !selected || selected === user.ownerIdentifier}
            onClick={() => run(() => manuallyLinkUser(user.id, selected), "Linked")}
          >
            Link
          </Button>
          {user.ownerIdentifier && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => manuallyUnlinkUser(user.id), "Unlinked")}
            >
              Unlink
            </Button>
          )}
          {user.ownerLinkSource === "manual" && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => resetUserLink(user.id), "Reset to auto")}
            >
              Reset
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}
