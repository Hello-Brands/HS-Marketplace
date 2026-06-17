"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { setLocationMapping } from "@/lib/boulevard/mapping-actions"

interface Row {
  locationId: string
  locationName: string
  listingId: string | null
  listingTitle: string | null
  listingStatus: string | null
  status: "unconfirmed" | "confirmed" | "not_connected"
  currentBoulevardId: string | null
  suggestedId: string | null
  suggestedConfidence: number | null
}

interface Props {
  rows: Row[]
  blvdLocations: { id: string; name: string }[]
  blvdConfigured: boolean
}

const NOT_CONNECTED = "__not_connected__"

function StatusBadge({ status }: { status: Row["status"] }) {
  const styles: Record<Row["status"], string> = {
    confirmed: "bg-green-100 text-green-800",
    unconfirmed: "bg-amber-100 text-amber-800",
    not_connected: "bg-gray-100 text-gray-600",
  }
  const labels: Record<Row["status"], string> = {
    confirmed: "Confirmed",
    unconfirmed: "Unconfirmed",
    not_connected: "Not connected",
  }
  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  )
}

export function BoulevardMappings({ rows, blvdLocations, blvdConfigured }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Per-row selected value (undefined = use default)
  const [selected, setSelected] = useState<Record<string, string>>({})
  // Per-row saving state
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  // Per-row error message
  const [errors, setErrors] = useState<Record<string, string>>({})

  function getSelectValue(row: Row): string {
    if (selected[row.locationId] !== undefined) return selected[row.locationId]
    return row.currentBoulevardId ?? row.suggestedId ?? NOT_CONNECTED
  }

  function handleSave(row: Row) {
    const value = getSelectValue(row)

    setSaving((prev) => ({ ...prev, [row.locationId]: true }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[row.locationId]
      return next
    })

    startTransition(async () => {
      const res =
        value === NOT_CONNECTED
          ? await setLocationMapping(row.locationId, {
              boulevardLocationId: null,
              status: "not_connected",
            })
          : await setLocationMapping(row.locationId, {
              boulevardLocationId: value,
              status: "confirmed",
            })

      setSaving((prev) => ({ ...prev, [row.locationId]: false }))

      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [row.locationId]: res.error ?? "Failed",
        }))
      } else {
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-gray-900">
          Boulevard Mappings
        </h1>
        <span className="text-sm text-gray-500">
          {rows.length} salon location{rows.length !== 1 ? "s" : ""}
        </span>
      </div>

      {!blvdConfigured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Boulevard API not configured — you can still mark locations Not
          connected.
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Salon Locations
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Confirm or override the Boulevard location linked to each salon.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No salon locations yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Location
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Listing
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Boulevard Mapping
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Save
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {rows.map((row) => {
                  const currentValue = getSelectValue(row)
                  const isSaving = saving[row.locationId] || isPending
                  const errorMsg = errors[row.locationId]
                  const showSuggestionHint =
                    row.suggestedId !== null &&
                    row.suggestedId !== row.currentBoulevardId &&
                    blvdConfigured

                  return (
                    <tr key={row.locationId} className="hover:bg-gray-50">
                      {/* Location */}
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900">
                          {row.locationName}
                        </p>
                        <p className="text-xs text-gray-400">{row.locationId}</p>
                      </td>

                      {/* Listing */}
                      <td className="px-6 py-4">
                        {row.listingTitle ? (
                          <>
                            <p className="text-sm text-gray-900">
                              {row.listingTitle}
                            </p>
                            {row.listingStatus && (
                              <span className="mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                                {row.listingStatus}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>

                      {/* Status badge */}
                      <td className="whitespace-nowrap px-6 py-4">
                        <StatusBadge status={row.status} />
                      </td>

                      {/* Boulevard mapping select */}
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <select
                            value={currentValue}
                            onChange={(e) =>
                              setSelected((prev) => ({
                                ...prev,
                                [row.locationId]: e.target.value,
                              }))
                            }
                            disabled={isSaving}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-hs-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 disabled:opacity-50"
                          >
                            <option value={NOT_CONNECTED}>
                              — Not connected —
                            </option>
                            {blvdLocations.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.name}
                              </option>
                            ))}
                          </select>
                          {showSuggestionHint && (
                            <p className="text-xs text-amber-600">
                              Suggested:{" "}
                              {
                                blvdLocations.find(
                                  (l) => l.id === row.suggestedId
                                )?.name ?? row.suggestedId
                              }{" "}
                              ({Math.round((row.suggestedConfidence ?? 0) * 100)}
                              % confidence)
                            </p>
                          )}
                          {errorMsg && (
                            <p className="text-xs text-hs-red-600">{errorMsg}</p>
                          )}
                        </div>
                      </td>

                      {/* Save button */}
                      <td className="whitespace-nowrap px-6 py-4">
                        <button
                          type="button"
                          onClick={() => handleSave(row)}
                          disabled={isSaving}
                          className="rounded-lg bg-hs-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-hs-red-700 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
                        >
                          {isSaving ? "Saving…" : "Save"}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
