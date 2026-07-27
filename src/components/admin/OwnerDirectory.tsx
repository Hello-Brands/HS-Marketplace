"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import {
  refreshOwnerDirectory,
  addOwnerLink,
  revokeOwnerLink,
  clearOwnerLink,
} from "@/lib/owner-directory/actions"
import {
  linkSourceBadgeVariant,
  addableOwners,
  type AdminUserRow,
  type AdminOwnerLink,
} from "@/lib/owner-directory/admin-view"
import { isEffectiveLinkSource } from "@/lib/owner-directory/link"

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
  multiLinkCount,
}: {
  directory: DirectoryRow[]
  users: AdminUserRow[]
  owners: Owner[]
  multiLinkCount: number
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
        <h2 className="text-lg font-semibold text-gray-900">Owner links</h2>
        <p className="text-sm text-gray-500">
          A user can hold several owner profiles — owners appear in the directory once per
          co-ownership grouping. Links are matched automatically from the directory contact
          email; add one by hand when a sign-in email differs. Manual links and revocations
          both survive re-sync.
          {multiLinkCount > 0 && (
            <>
              {" "}
              <span className="font-medium text-gray-700">
                {multiLinkCount} user{multiLinkCount !== 1 ? "s" : ""} linked to multiple owners.
              </span>
            </>
          )}
        </p>
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">User</th>
                <th className="text-left font-semibold px-4 py-2.5">Linked owners</th>
                <th className="text-left font-semibold px-4 py-2.5">Add</th>
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
            className="w-full sm:w-80 rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
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
  user: AdminUserRow
  owners: Owner[]
  pending: boolean
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void
}) {
  const [selected, setSelected] = useState("")
  const inDirectory = useMemo(
    () => new Set(owners.map((o) => o.ownerIdentifier)),
    [owners]
  )
  const addable = useMemo(() => addableOwners(owners, user.links), [owners, user.links])

  return (
    <tr>
      <td className="px-4 py-2.5 align-top">
        <div className="font-medium text-gray-900">{user.name || "—"}</div>
        <div className="text-gray-500">{user.email}</div>
      </td>
      <td className="px-4 py-2.5 align-top">
        {user.links.length === 0 ? (
          <span className="text-gray-400">—</span>
        ) : (
          <div className="flex flex-col gap-1.5 items-start">
            {user.links.map((link) => (
              <LinkChip
                key={link.ownerIdentifier}
                link={link}
                userId={user.id}
                ownerName={owners.find((o) => o.ownerIdentifier === link.ownerIdentifier)?.ownerName ?? null}
                inDirectory={inDirectory.has(link.ownerIdentifier)}
                pending={pending}
                run={run}
              />
            ))}
          </div>
        )}
      </td>
      <td className="px-4 py-2.5 align-top">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm max-w-[14rem]"
          >
            <option value="">Select owner…</option>
            {addable.map((o) => (
              <option key={o.ownerIdentifier} value={o.ownerIdentifier}>
                {o.ownerIdentifier}
                {o.ownerName ? ` (${o.ownerName})` : ""}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !selected}
            onClick={() =>
              run(async () => {
                const res = await addOwnerLink(user.id, selected)
                if (res.ok) setSelected("")
                return res
              }, "Linked")
            }
          >
            Add
          </Button>
        </div>
      </td>
    </tr>
  )
}

/**
 * One owner link. Revoked links stay visible (muted, with an undo) so a
 * suppression is never invisible — otherwise a deliberately-blocked owner
 * looks like a bug months later.
 */
function LinkChip({
  link,
  userId,
  ownerName,
  inDirectory,
  pending,
  run,
}: {
  link: AdminOwnerLink
  userId: string
  ownerName: string | null
  inDirectory: boolean
  pending: boolean
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void
}) {
  const effective = isEffectiveLinkSource(link.source)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ${
        effective ? "border-gray-200 bg-white" : "border-dashed border-gray-300 bg-gray-50"
      }`}
    >
      <span className={effective ? "text-gray-900" : "text-gray-400 line-through"}>
        {link.ownerIdentifier}
      </span>
      {ownerName && <span className="text-xs text-gray-400">({ownerName})</span>}
      <Badge variant={linkSourceBadgeVariant(link.source)} size="sm">
        {link.source}
      </Badge>
      {!inDirectory && (
        <Badge variant="warning" size="sm">
          not in directory
        </Badge>
      )}
      {effective ? (
        <button
          type="button"
          aria-label={`Revoke ${link.ownerIdentifier}`}
          disabled={pending}
          onClick={() => run(() => revokeOwnerLink(userId, link.ownerIdentifier), "Revoked")}
          className="text-gray-400 hover:text-hs-red-600 disabled:opacity-40 px-0.5"
        >
          ×
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => clearOwnerLink(userId, link.ownerIdentifier), "Revocation cleared")}
          className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 underline"
        >
          undo
        </button>
      )}
    </span>
  )
}
