/**
 * Brand-request admin core — shared by src/lib/brand-requests/actions.ts and
 * the MCP write tools. `submitBrandRequest` (franchisee-facing) stays in the
 * actions file; only the admin decisions live here.
 *
 * This module is deliberately NOT a `"use server"` file. These functions take
 * a trusted `AdminActor` and do NOT check auth themselves. Do not re-export
 * them from a `"use server"` module and do not add `"use server"` here.
 *
 * `updated_at` is always set explicitly — Postgres does not refresh it on
 * UPDATE, and the monitor repo relies on it to tell how stale a row is.
 */
import { db } from '@/db'
import { brandRequests, type BrandRequestStatus } from '@/db/schema/brandRequests'
import { dispatchMonitorEvent } from '@/lib/brand-requests/dispatch'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { withAudit } from '@/lib/admin/audit'
import type { AdminActor } from './actor'

const ACCOUNT_PATH = '/account/brand-requests'
const ADMIN_PATH = '/admin/brand-requests'

/**
 * Statuses past the point of no return — a decision has already been acted on.
 *
 * Exported because the MCP `reject_brand_request` tool re-runs this same rule on
 * its confirmation-preview path (spec §7.5) and must not keep a second copy that
 * can drift from this one.
 */
export const APPROVED_STATUSES: readonly BrandRequestStatus[] = ['approved', 'building', 'live']

/** Approving these requires the explicit `withoutRecon` override. */
const OVERRIDE_APPROVABLE: BrandRequestStatus[] = ['submitted', 'recon_running', 'needs_human']

/** Best-effort note on the row; never let a bookkeeping write mask the outcome. */
async function recordDispatchError(requestId: string, message: string) {
  try {
    await db
      .update(brandRequests)
      .set({ error: message, updatedAt: new Date() })
      .where(eq(brandRequests.id, requestId))
  } catch (err) {
    console.error('[brand-requests] could not record dispatch error', requestId, err)
  }
}

export async function approveBrandRequest(
  actor: AdminActor,
  requestId: string,
  options?: { withoutRecon?: boolean },
) {
  const { result, auditId } = await withAudit(
    actor,
    'brand_request.approve',
    { type: 'brand_request', id: requestId },
    { requestId, withoutRecon: options?.withoutRecon === true },
    async () => {
      const request = await db.query.brandRequests.findFirst({
        where: eq(brandRequests.id, requestId),
      })
      if (!request) throw new Error('Request not found')

      if (APPROVED_STATUSES.includes(request.status)) {
        throw new Error('Request is already approved.')
      }
      if (request.status === 'rejected') {
        throw new Error('Request was rejected. The franchisee can submit it again.')
      }

      // Normally we wait for recon so the admin sees the cost estimate first; the
      // override exists for brands we already know we want (or a stuck recon).
      const approvable =
        request.status === 'recon_complete' ||
        (options?.withoutRecon === true && OVERRIDE_APPROVABLE.includes(request.status))
      if (!approvable) {
        throw new Error(
          'Recon has not completed yet. Wait for the cost estimate or approve without recon.',
        )
      }

      await db
        .update(brandRequests)
        .set({
          status: 'approved',
          decidedBy: actor.userId,
          decidedAt: new Date(),
          rejectReason: null,
          updatedAt: new Date(),
        })
        .where(eq(brandRequests.id, requestId))

      // Approval is committed before the handoff and does NOT roll back on failure —
      // `dispatched: false` tells the UI to offer a retry.
      const dispatch = await dispatchMonitorEvent('brand-build', requestId)
      if (!dispatch.ok) {
        await recordDispatchError(requestId, `Build dispatch failed: ${dispatch.error}`)
      }

      revalidatePath(ADMIN_PATH)
      revalidatePath(`${ADMIN_PATH}/${requestId}`)
      revalidatePath(ACCOUNT_PATH)
      return { success: true as const, dispatched: dispatch.ok }
    },
  )
  return { ...result, auditId }
}

export async function rejectBrandRequest(actor: AdminActor, requestId: string, reason: string) {
  const { result, auditId } = await withAudit(
    actor,
    'brand_request.reject',
    { type: 'brand_request', id: requestId },
    { requestId, reason },
    async () => {
      const request = await db.query.brandRequests.findFirst({
        where: eq(brandRequests.id, requestId),
      })
      if (!request) throw new Error('Request not found')

      // The reason is shown to the franchisee, so it must be present and readable.
      const trimmed = reason.trim()
      if (!trimmed) throw new Error('A rejection reason is required.')
      if (trimmed.length > 500) {
        throw new Error('Keep the rejection reason under 500 characters.')
      }

      if (request.status === 'rejected') {
        throw new Error('Request is already rejected.')
      }
      if (APPROVED_STATUSES.includes(request.status)) {
        throw new Error(
          'Request is already approved and being set up — it can no longer be rejected.',
        )
      }

      await db
        .update(brandRequests)
        .set({
          status: 'rejected',
          rejectReason: trimmed,
          decidedBy: actor.userId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(brandRequests.id, requestId))

      revalidatePath(ADMIN_PATH)
      revalidatePath(`${ADMIN_PATH}/${requestId}`)
      revalidatePath(ACCOUNT_PATH)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}

/**
 * Re-fire a handoff that failed (or that the monitor never picked up). Gated on
 * status so a retry can't restart a pipeline stage that already moved past it.
 */
export async function retryMonitorDispatch(
  actor: AdminActor,
  requestId: string,
  kind: 'recon' | 'build',
) {
  const { result, auditId } = await withAudit(
    actor,
    'brand_request.retry_dispatch',
    { type: 'brand_request', id: requestId },
    { requestId, kind },
    async () => {
      const request = await db.query.brandRequests.findFirst({
        where: eq(brandRequests.id, requestId),
      })
      if (!request) throw new Error('Request not found')

      const allowed: BrandRequestStatus[] =
        kind === 'recon' ? ['submitted', 'recon_running'] : ['approved', 'building']
      if (!allowed.includes(request.status)) {
        throw new Error(`Cannot retry ${kind} dispatch from status "${request.status}".`)
      }

      const dispatch = await dispatchMonitorEvent(
        kind === 'recon' ? 'brand-recon' : 'brand-build',
        requestId,
      )
      if (!dispatch.ok) {
        await recordDispatchError(requestId, `Dispatch failed: ${dispatch.error}`)
        throw new Error(`Dispatch failed: ${dispatch.error}`)
      }

      // Handoff accepted — clear the stale failure note.
      await db
        .update(brandRequests)
        .set({ error: null, updatedAt: new Date() })
        .where(eq(brandRequests.id, requestId))

      revalidatePath(`${ADMIN_PATH}/${requestId}`)
      revalidatePath(ADMIN_PATH)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}
