import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { getUserAnalytics } from "../actions"
import { Sparkline } from "@/components/admin/Sparkline"

type Props = { params: Promise<{ userId: string }> }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold text-gray-900 leading-none">{value}</div>
    </div>
  )
}

export default async function UserAnalyticsDetailPage({ params }: Props) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") redirect("/")

  const { userId } = await params
  const u = (await getUserAnalytics()).find((r) => r.id === userId)
  if (!u) notFound()

  const lastActive = u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"

  return (
    <div>
      <Link href="/admin/analytics" className="text-sm text-hs-red-600 hover:underline">← Back to Analytics</Link>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">{u.name ?? "Unnamed user"}</h1>
      <p className="text-sm text-gray-500">{u.email} · {u.role}</p>

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Logins" value={String(u.loginCount)} />
        <Stat label="Last active" value={lastActive} />
        <Stat label="Listings posted" value={String(u.listingsPosted)} />
        <Stat label="Reach-outs sent" value={String(u.reachOutsSent)} />
        <Stat label="Inquiries received" value={String(u.inquiriesReceived)} />
        <Stat label="Saves made" value={String(u.savesMade)} />
      </div>

      <div className="mt-5 bg-white border border-gray-200 rounded-xl p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">Logins — last 7 days</div>
        <Sparkline data={u.spark} />
      </div>
    </div>
  )
}
