'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import {
  brandRequests,
  type BrandRequestStatus,
} from '@/db/schema/brandRequests'
import { monitoredBrands } from '@/db/schema/monitoredBrands'
import { requireAdmin } from '@/lib/auth-guards'
import { checkRateLimit } from '@/lib/rate-limit'
import { dispatchMonitorEvent } from '@/lib/brand-requests/dispatch'
import { isBlockedDomain, normalizeWebsiteUrl } from '@/lib/brand-requests/normalize'
import { and, eq, ne, or, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

/**
 * Server actions for the "request a competitor brand" pipeline.
 *
 * Two call conventions on purpose, matching the two house patterns:
 *   - submitBrandRequest is a useActionState action (see contact-actions.ts) and
 *     RETURNS `{ error }` so the franchisee sees inline validation copy.
 *   - the admin actions THROW (see admin/actions.ts) and are wrapped in
 *     try/catch by their client callers.
 *
 * `updated_at` is always set explicitly — the column has a default but Postgres
 * does not refresh it on UPDATE, and the monitor repo relies on it to tell how
 * stale a row is.
 */

const ACCOUNT_PATH = '/account/brand-requests'
const ADMIN_PATH = '/admin/brand-requests'

/** Statuses past the point of no return — a decision has already been acted on. */
const APPROVED_STATUSES: BrandRequestStatus[] = ['approved', 'building', 'live']

/** Approving these requires the explicit `withoutRecon` override. */
const OVERRIDE_APPROVABLE: BrandRequestStatus[] = [
  'submitted',
  'recon_running',
  'needs_human',
]

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

const submitSchema = z.object({
  brandName: z.string().trim().min(2, 'Enter the brand name.').max(120),
  websiteUrl: z.string().trim().min(1, 'Enter the brand website.').max(500),
  note: z.string().trim().max(2000).optional(),
  knownCityState: z.string().trim().max(120).optional(),
})

export async function submitBrandRequest(
  prevState: unknown,
  formData: FormData,
): Promise<{ error: string } | { success: true }> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { error: 'Not authenticated' }

  // Each submit fires a GitHub workflow that spends CI minutes and LLM budget,
  // so cap bursts per franchisee (DEBT-028; best-effort per-instance).
  const limit = checkRateLimit(`brand-request:${userId}`, 5, 60_000)
  if (!limit.allowed) {
    return { error: 'Too many requests. Please try again in a minute.' }
  }

  const parsed = submitSchema.safeParse({
    brandName: formData.get('brandName'),
    websiteUrl: formData.get('websiteUrl'),
    note: formData.get('note') || undefined,
    knownCityState: formData.get('knownCityState') || undefined,
  })
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid form data' }
  }
  const { brandName, note, knownCityState } = parsed.data

  const normalized = normalizeWebsiteUrl(parsed.data.websiteUrl)
  if (!normalized) {
    return { error: 'Enter a valid website address (e.g. https://brandname.com).' }
  }
  const { url, domain } = normalized

  if (isBlockedDomain(domain)) {
    return {
      error:
        "That looks like a social or review page. Please link to the brand's own website instead.",
    }
  }

  // Reachability, not health: a 403 from a WAF or a 404 on the root path still
  // proves DNS resolves and something is serving. Only a thrown error (bad DNS,
  // refused connection, 8s timeout) means the address is unusable.
  try {
    await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    })
  } catch {
    return {
      error: "We couldn't reach that website. Double-check the address and try again.",
    }
  }

  // Dedupe 1: already monitored — the franchisee should use the existing brand.
  // monitored_brands.domain is stored bare/lowercase, matching `domain`.
  const monitored = await db.query.monitoredBrands.findFirst({
    where: or(
      eq(monitoredBrands.domain, domain),
      eq(sql<string>`lower(${monitoredBrands.name})`, brandName.toLowerCase()),
    ),
  })
  if (monitored) {
    return { error: `${monitored.name} is already being monitored.` }
  }

  // Dedupe 2: an open request for the same brand. Rejected rows deliberately do
  // NOT block — a franchisee may resubmit with a better website or note.
  const existing = await db.query.brandRequests.findFirst({
    where: and(
      or(
        eq(brandRequests.normalizedDomain, domain),
        eq(sql<string>`lower(${brandRequests.brandName})`, brandName.toLowerCase()),
      ),
      ne(brandRequests.status, 'rejected'),
    ),
  })
  if (existing) {
    return { error: 'This brand has already been requested and is pending review.' }
  }

  // Generated here rather than relying on the column default: the dispatch
  // payload needs the id, and neon-http gives us no transaction to read it back
  // in (see the neon-http note in the db layer).
  const id = crypto.randomUUID()
  await db.insert(brandRequests).values({
    id,
    brandName,
    websiteUrl: url,
    normalizedDomain: domain,
    note: note ?? null,
    knownCityState: knownCityState ?? null,
    submittedBy: userId,
    updatedAt: new Date(),
  })

  // The submission stands even if the handoff fails — the row is recorded and an
  // admin can retry the recon dispatch from the queue.
  const dispatch = await dispatchMonitorEvent('brand-recon', id)
  if (!dispatch.ok) {
    await recordDispatchError(id, `Recon dispatch failed: ${dispatch.error}`)
  }

  revalidatePath(ACCOUNT_PATH)
  revalidatePath(ADMIN_PATH)
  return { success: true }
}

export async function approveBrandRequest(
  requestId: string,
  options?: { withoutRecon?: boolean },
) {
  const admin = await requireAdmin()

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
      decidedBy: admin.id ?? null,
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
  return { success: true, dispatched: dispatch.ok }
}

export async function rejectBrandRequest(requestId: string, reason: string) {
  const admin = await requireAdmin()

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
      decidedBy: admin.id ?? null,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(brandRequests.id, requestId))

  revalidatePath(ADMIN_PATH)
  revalidatePath(`${ADMIN_PATH}/${requestId}`)
  revalidatePath(ACCOUNT_PATH)
  return { success: true }
}

/**
 * Re-fire a handoff that failed (or that the monitor never picked up). Gated on
 * status so a retry can't restart a pipeline stage that already moved past it.
 */
export async function retryMonitorDispatch(
  requestId: string,
  kind: 'recon' | 'build',
) {
  await requireAdmin()

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
  return { success: true }
}
