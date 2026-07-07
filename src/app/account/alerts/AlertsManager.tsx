"use client"

import { useState } from "react"
import Link from "next/link"
import type { Alert } from "@/db/schema/alerts"
import { updateAlert, deleteAlert } from "@/lib/alert-actions"
import { SavedSearchCard } from "@/components/alerts/SavedSearchCard"

export function AlertsManager({ initialAlerts }: { initialAlerts: Alert[] }) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts)
  const [error, setError] = useState<string | null>(null)

  async function handleRename(id: string, name: string | null) {
    setError(null)
    try {
      const result = await updateAlert(id, { name })
      if (result.error) setError(result.error)
      else setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, name } : a)))
    } catch {
      setError("Couldn't save — check your connection and try again.")
    }
  }

  async function handleToggleNotify(id: string, enabled: boolean) {
    setError(null)
    try {
      const result = await updateAlert(id, { notifyEnabled: enabled })
      if (result.error) setError(result.error)
      else setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, notifyEnabled: enabled } : a)))
    } catch {
      setError("Couldn't update — check your connection and try again.")
    }
  }

  async function handleDelete(id: string) {
    setError(null)
    try {
      const result = await deleteAlert(id)
      if (result.error) setError(result.error)
      else setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch {
      setError("Couldn't delete — check your connection and try again.")
    }
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <p className="text-gray-600 font-medium">No saved searches yet</p>
        <p className="text-sm text-gray-500 mt-1 mb-4">Set filters on the browse page, then tap &ldquo;Save this search&rdquo;.</p>
        <Link href="/browse" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700">
          Go to Browse →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="bg-hs-red-50 border border-hs-red-200 text-hs-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}
      {alerts.map((alert) => (
        <SavedSearchCard
          key={alert.id}
          alert={alert}
          onRename={handleRename}
          onDelete={handleDelete}
          onToggleNotify={handleToggleNotify}
        />
      ))}
    </div>
  )
}
