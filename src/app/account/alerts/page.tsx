import Link from "next/link"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getMyAlerts } from "@/lib/alert-actions"
import { AppHeader } from "@/components/layout/AppHeader"
import { AlertsManager } from "./AlertsManager"

export default async function AlertsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const isAdmin = session.user.role === "admin"
  const hasSeller = !!session.user.sellerAccess || isAdmin
  const isOwner = !!session.user.ownerIdentifier

  const alerts = await getMyAlerts()

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="My Alerts" subtitle={`${alerts.length} saved search${alerts.length !== 1 ? "es" : ""}`} isAdmin={isAdmin} hasSeller={hasSeller} isOwner={isOwner} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Saved searches</h2>
            <p className="text-sm text-gray-500 mt-1">Apply a saved search to browse it again, or get emailed when a new match is listed.</p>
          </div>
          <Link href="/browse" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
            ← Browse listings
          </Link>
        </div>
        <AlertsManager initialAlerts={alerts} />
      </div>
    </div>
  )
}
