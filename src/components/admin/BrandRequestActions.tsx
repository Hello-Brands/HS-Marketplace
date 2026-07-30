'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from './ConfirmDialog'
import {
  approveBrandRequest,
  rejectBrandRequest,
  retryMonitorDispatch,
} from '@/lib/brand-requests/actions'
import type { BrandRequestStatus } from '@/db/schema/brandRequests'

/**
 * Admin decision controls for one brand request — action wiring mirrors
 * ModerationQueue.tsx (try/catch into a role="alert" banner, router.refresh()
 * on success, buttons disabled while a call is in flight).
 *
 * Which buttons render is driven by the same status gates the server actions
 * enforce, so the UI never offers a transition the action would reject. The
 * server actions remain the authority — these are affordances, not the check.
 *
 * The reject flow uses a local modal rather than RejectionModal: that component
 * is listing-specific (fixed reason <select> + separate notes field), while
 * rejectBrandRequest takes one free-text reason shown to the franchisee.
 */

/** Statuses where a decision has already been acted on — no actions remain. */
const APPROVED_STATUSES: BrandRequestStatus[] = ['approved', 'building', 'live']

/** Approving from these requires the explicit `withoutRecon` override. */
const OVERRIDE_APPROVABLE: BrandRequestStatus[] = [
  'submitted',
  'recon_running',
  'needs_human',
]

const RETRY_RECON_STATUSES: BrandRequestStatus[] = ['submitted', 'recon_running']
const RETRY_BUILD_STATUSES: BrandRequestStatus[] = ['approved', 'building']

interface BrandRequestActionsProps {
  requestId: string
  status: BrandRequestStatus
  hasError?: boolean
}

type Dialog = 'approve' | 'approve-without-recon' | null

export function BrandRequestActions({
  requestId,
  status,
  hasError = false,
}: BrandRequestActionsProps) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const run = async (fn: () => Promise<unknown>, onDone?: () => void) => {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
      onDone?.()
      router.refresh()
    } catch (error) {
      setActionError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canApprove = status === 'recon_complete'
  const canApproveWithoutRecon = OVERRIDE_APPROVABLE.includes(status)
  const canReject = !APPROVED_STATUSES.includes(status) && status !== 'rejected'
  const canRetryRecon = RETRY_RECON_STATUSES.includes(status)
  const canRetryBuild = RETRY_BUILD_STATUSES.includes(status)

  const hasAnyAction =
    canApprove || canApproveWithoutRecon || canReject || canRetryRecon || canRetryBuild

  // A failed handoff is the one thing an admin must act on, so promote the retry
  // out of the outline treatment when the row is carrying an error.
  const retryClass = hasError
    ? 'px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2'
    : 'px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2'

  return (
    <>
      {actionError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-hs-red-200 bg-hs-red-50 px-4 py-3 text-sm text-hs-red-700"
        >
          {actionError}
        </div>
      )}

      {hasAnyAction ? (
        <div className="flex flex-wrap gap-3">
          {canApprove && (
            <button
              onClick={() => setDialog('approve')}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
            >
              Approve
            </button>
          )}

          {canApproveWithoutRecon && (
            <button
              onClick={() => setDialog('approve-without-recon')}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-hs-red-300 bg-white text-sm font-semibold text-hs-red-700 hover:bg-hs-red-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
            >
              Approve without recon
            </button>
          )}

          {canRetryRecon && (
            <button
              onClick={() => run(() => retryMonitorDispatch(requestId, 'recon'))}
              disabled={busy}
              className={retryClass}
            >
              Retry recon dispatch
            </button>
          )}

          {canRetryBuild && (
            <button
              onClick={() => run(() => retryMonitorDispatch(requestId, 'build'))}
              disabled={busy}
              className={retryClass}
            >
              Retry build dispatch
            </button>
          )}

          {canReject && (
            <button
              onClick={() => {
                setReason('')
                setRejecting(true)
              }}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-hs-red-300 bg-white text-sm font-medium text-hs-red-700 hover:bg-hs-red-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
            >
              Reject
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">
          {status === 'live'
            ? 'This brand is live — nothing left to decide.'
            : 'This request was rejected. The franchisee can submit it again.'}
        </p>
      )}

      <ConfirmDialog
        isOpen={dialog === 'approve'}
        title="Approve brand request"
        message="Approving hands this brand off to the monitor, which opens a build PR and starts tracking its locations."
        confirmLabel="Approve"
        onConfirm={() => run(() => approveBrandRequest(requestId), () => setDialog(null))}
        onCancel={() => setDialog(null)}
        isProcessing={busy}
      />

      <ConfirmDialog
        isOpen={dialog === 'approve-without-recon'}
        title="Approve without recon?"
        message="Recon has not finished, so there is no location count or monthly cost estimate yet. The build will start anyway and may cost more than expected."
        confirmLabel="Approve anyway"
        variant="warning"
        onConfirm={() =>
          run(
            () => approveBrandRequest(requestId, { withoutRecon: true }),
            () => setDialog(null),
          )
        }
        onCancel={() => setDialog(null)}
        isProcessing={busy}
      />

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setRejecting(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-request-title"
            className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl max-h-[90dvh] overflow-y-auto"
          >
            <h2
              id="reject-request-title"
              className="text-lg font-semibold text-gray-900"
            >
              Reject brand request
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              The reason is shown to the franchisee who requested this brand.
            </p>

            <label
              htmlFor="brandRejectReason"
              className="mt-4 block text-sm font-medium text-gray-700"
            >
              Reason <span className="text-hs-red-500">*</span>
            </label>
            <textarea
              id="brandRejectReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              required
              placeholder="e.g. Too few locations near our markets to be worth tracking."
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-hs-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setRejecting(false)}
                disabled={busy}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  run(() => rejectBrandRequest(requestId, reason), () =>
                    setRejecting(false),
                  )
                }
                disabled={busy || !reason.trim()}
                className="px-4 py-2 rounded-lg bg-hs-red-600 text-sm font-semibold text-white hover:bg-hs-red-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
              >
                {busy ? 'Rejecting…' : 'Reject request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
