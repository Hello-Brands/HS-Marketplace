import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getMyAlerts } from "@/lib/alert-actions"
import { SiteHeader } from "@/components/layout/SiteHeader"
import { AlertsManager } from "./AlertsManager"

export default async function AlertsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const alerts = await getMyAlerts()

  return (
    <div className="min-h-screen">
      <SiteHeader
        world="marketplace"
        title="My Alerts"
        subtitle={`${alerts.length} saved search${alerts.length !== 1 ? "es" : ""}`}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-semibold text-gray-900">Saved searches</h2>
          <p className="text-sm text-gray-500 mt-1">Apply a saved search to browse it again, or get emailed when a new match is listed.</p>
        </div>
        <AlertsManager initialAlerts={alerts} />
      </div>
    </div>
  )
}
