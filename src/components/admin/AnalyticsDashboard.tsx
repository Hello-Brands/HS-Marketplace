"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import type { AnalyticsSummary, UserAnalyticsRow, LoginTrendPoint } from "@/app/admin/analytics/actions"
import { LoginTrendChart } from "./LoginTrendChart"
import { Sparkline } from "./Sparkline"

type SortKey =
  | "loginCount" | "lastLoginAt" | "listingsPosted"
  | "reachOutsSent" | "inquiriesReceived" | "savesMade"

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "loginCount", label: "Logins" },
  { key: "lastLoginAt", label: "Last active" },
  { key: "listingsPosted", label: "Listings" },
  { key: "reachOutsSent", label: "Reach-outs sent" },
  { key: "inquiriesReceived", label: "Inquiries recv'd" },
  { key: "savesMade", label: "Saves" },
]

function timeAgo(d: Date | null): string {
  if (!d) return "—"
  const ms = Date.now() - new Date(d).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d ago`
  const hrs = Math.floor(ms / 3_600_000)
  if (hrs >= 1) return `${hrs}h ago`
  const mins = Math.floor(ms / 60_000)
  return mins <= 1 ? "just now" : `${mins}m ago`
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold text-gray-900 leading-none">{value}</div>
      {hint && <div className="mt-1.5 text-xs font-semibold text-green-600">{hint}</div>}
    </div>
  )
}

export function AnalyticsDashboard({
  summary, users, trend,
}: {
  summary: AnalyticsSummary
  users: UserAnalyticsRow[]
  trend: LoginTrendPoint[]
}) {
  const [query, setQuery] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("loginCount")
  const [asc, setAsc] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? users.filter(
          (u) =>
            (u.name ?? "").toLowerCase().includes(q) ||
            (u.email ?? "").toLowerCase().includes(q) ||
            u.role.toLowerCase().includes(q),
        )
      : users
    const sorted = [...filtered].sort((a, b) => {
      const av = sortKey === "lastLoginAt" ? (a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0) : (a[sortKey] as number)
      const bv = sortKey === "lastLoginAt" ? (b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0) : (b[sortKey] as number)
      return asc ? av - bv : bv - av
    })
    return sorted
  }, [users, query, sortKey, asc])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAsc((v) => !v)
    else { setSortKey(key); setAsc(false) }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
      <p className="mt-1 text-sm text-gray-500">
        Logins and views accrue from launch — early numbers will be low and grow over time.
      </p>

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total users" value={String(summary.totalUsers)} />
        <SummaryCard label="Active this week" value={String(summary.activeThisWeek)} />
        <SummaryCard label="Logins (30d)" value={String(summary.logins30d)} />
        <SummaryCard label="Inquiries (30d)" value={String(summary.inquiries30d)} />
      </div>

      <div className="mt-5 bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-3">Logins — last 30 days</div>
        <LoginTrendChart data={trend} />
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or role…"
          className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-hs-red-300"
        />
        <span className="text-xs text-gray-400">{rows.length} user{rows.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="mt-3 overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2.5 font-bold">User</th>
              <th className="px-3 py-2.5 font-bold">Role</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="px-3 py-2.5 font-bold text-center whitespace-nowrap">
                  <button onClick={() => toggleSort(c.key)} className={`inline-flex items-center gap-1 ${sortKey === c.key ? "text-hs-red-600" : "hover:text-gray-700"}`}>
                    {c.label}{sortKey === c.key ? (asc ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
              <th className="px-3 py-2.5 font-bold text-center">7-day</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2.5">
                  <Link href={`/admin/analytics/${u.id}`} className="flex flex-col">
                    <span className="font-semibold text-gray-900">{u.name ?? "—"}</span>
                    <span className="text-xs text-gray-400">{u.email}</span>
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${u.role === "admin" ? "bg-hs-red-100 text-hs-red-800" : "bg-gray-100 text-gray-600"}`}>{u.role}</span>
                </td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.loginCount}</td>
                <td className="px-3 py-2.5 text-center text-gray-500">{timeAgo(u.lastLoginAt)}</td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.listingsPosted || "—"}</td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.reachOutsSent || "—"}</td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.inquiriesReceived || "—"}</td>
                <td className="px-3 py-2.5 text-center font-semibold text-gray-900">{u.savesMade || "—"}</td>
                <td className="px-3 py-2.5"><div className="flex justify-center"><Sparkline data={u.spark} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
