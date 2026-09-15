'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from '@/components/admin/ConfirmDialog'
import {
  mcpConnectionStatus,
  MCP_CONNECTION_STATUS_LABELS,
  type McpConnectionStatus,
} from '@/lib/mcp/oauth/connection-status'
import { revokeMcpConnection } from '@/app/admin/mcp-connections/actions'

/**
 * Admin MCP connection table — mirrors BrandRequestsTable.tsx (client table,
 * same cell/typography scale) plus a row action, using the shared
 * ConfirmDialog the way UsersManager does.
 */

export interface McpConnectionTableRow {
  id: string
  userEmail: string | null
  clientId: string
  clientName: string
  scope: string
  label: string | null
  createdAt: Date
  lastUsedAt: Date | null
  expiresAt: Date
  refreshExpiresAt: Date
  revokedAt: Date | null
}

interface McpConnectionsTableProps {
  connections: McpConnectionTableRow[]
  showAll: boolean
}

const STATUS_CLASSES: Record<McpConnectionStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  idle: 'bg-gray-100 text-gray-600',
  expired: 'bg-amber-50 text-amber-700',
  revoked: 'bg-hs-red-50 text-hs-red-700',
}

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Denver',
  }).format(new Date(date))

function scopeLabel(scope: string): string {
  return scope.includes('marketplace:write') ? 'Read and write' : 'Read only'
}

export function McpConnectionsTable({ connections, showAll }: McpConnectionsTableProps) {
  const router = useRouter()
  // NOT useTransition: React 18's `pending` flips back to false as soon as the
  // synchronous prefix of an async transition callback runs (tracking the
  // whole async body is a React 19 behaviour), so it never actually gated the
  // UI during the request -- a double-click could fire two revocations (two
  // audit rows). A plain busy flag set before the await and cleared in
  // `finally` is the house pattern (see BrandRequestActions.tsx).
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<McpConnectionTableRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function confirmRevoke() {
    if (!target) return
    const tokenId = target.id
    setBusy(true)
    try {
      const result = await revokeMcpConnection(tokenId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      router.refresh()
    } catch (error) {
      // Only the two expected failures come back as { ok: false }; an expired
      // session (requireAdmin throws), a db failure or a failed audit write
      // rejects instead. Without this the dialog would sit open with no
      // message and no way to tell whether the connection was revoked.
      setError((error as Error)?.message || 'Revoke failed')
    } finally {
      setTarget(null)
      setBusy(false)
    }
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
        {showAll
          ? 'No admin has connected an MCP client yet.'
          : 'You have not connected an MCP client yet.'}
      </div>
    )
  }

  return (
    <>
      {error && (
        <p role="alert" className="rounded-lg bg-hs-red-50 px-4 py-3 text-sm text-hs-red-700">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Connection
                </th>
                {showAll && (
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Admin
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Client
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Access
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Created
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Last used
                </th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {connections.map((connection) => {
                const status = mcpConnectionStatus(connection)
                return (
                  <tr key={connection.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 font-medium text-gray-900">
                      {connection.label ?? '—'}
                    </td>
                    {showAll && (
                      <td className="px-4 py-4 text-sm text-gray-500">
                        {connection.userEmail ?? '—'}
                      </td>
                    )}
                    <td className="px-4 py-4 text-sm text-gray-500">{connection.clientName}</td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {scopeLabel(connection.scope)}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`inline-block rounded-full px-2 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}
                      >
                        {MCP_CONNECTION_STATUS_LABELS[status]}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {formatDateTime(connection.createdAt)}
                    </td>
                    <td className="px-4 py-4 text-sm text-gray-500">
                      {connection.lastUsedAt ? formatDateTime(connection.lastUsedAt) : 'Never'}
                    </td>
                    <td className="px-4 py-4 text-right">
                      {status === 'revoked' ? (
                        <span className="text-sm text-gray-400">Revoked</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTarget(connection)}
                          disabled={busy}
                          className="text-sm font-semibold text-hs-red-600 hover:text-hs-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        isOpen={target !== null}
        title="Revoke this connection?"
        message={`${
          target?.label ?? target?.clientName ?? 'This connection'
        } will stop working immediately, and the client will have to authorize again.`}
        confirmLabel="Revoke"
        variant="danger"
        isProcessing={busy}
        onConfirm={confirmRevoke}
        onCancel={() => setTarget(null)}
      />
    </>
  )
}
