'use server'

import { db } from '@/db'
import { listings } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { revalidatePath } from 'next/cache'
import type { ListingFormData, ListingStatus } from './types'
import { canTransition } from './status-machine'
import { nextListedAt } from '@/lib/analytics/helpers'
import { buildListingUpdate } from './build-update'
import { parseListingPatch } from './schemas'
import { requireSellerAccess } from '@/lib/auth-guards'
import { hasAcknowledgedCurrentFdd } from './disclaimer'
import {
  buildLocationInserts,
  buildPhotoInserts,
  buildLocationSync,
  buildPhotoSync,
} from './persist'

export async function saveDraft(input: Partial<ListingFormData>, listingId?: string) {
  const user = await requireSellerAccess()

  // Validate server-side. The zod schemas were previously wired only into the
  // client's react-hook-form resolver, so every type, range and max-length
  // constraint was bypassed by invoking this action directly or by posting to
  // /api/listings/draft, which passes `await request.json()` straight through.
  // Using the parsed output also strips unknown keys and turns the JSON route's
  // ISO date strings into Dates.
  const data = parseListingPatch(input)

  // Determine type: bundle if >1 location, else use explicit type or infer from location
  const type = data.locations && data.locations.length > 1
    ? 'bundle'
    : data.type || (data.locations?.[0]?.type === 'territory' ? 'territory' : 'suite')

  // Generate title from locations
  const title = data.locations?.map(l => l.name).join(' + ') || 'Untitled Listing'

  if (listingId) {
    // Update existing draft — only by its owner (or an admin). Without this
    // check any seller could overwrite another seller's listing via the
    // draft API route, which passes a client-supplied listingId through.
    const [existing] = await db.select()
      .from(listings)
      .where(eq(listings.id, listingId))

    if (!existing) throw new Error('Listing not found')
    if (existing.sellerId !== user.id && user.role !== 'admin') {
      throw new Error('Not authorized')
    }

    // Atomic edit (DEBT-027): the parent-listing update, the location delete/reinserts,
    // and the photo delete/reinserts all commit in ONE neon-http batch (a single
    // transaction) — mirroring the create path — so a mid-sequence failure can no
    // longer leave the parent row updated while its locations/photos stay stale.
    // All async resolution (location snapshot + owner directory + geocode) runs inside
    // buildLocationSync, BEFORE the batch is composed. Normalized money/asset fields
    // come from the single shared helper (DEBT-003/004).
    const parentUpdate = db.update(listings)
      .set({
        type,
        title,
        ...buildListingUpdate(data, existing),
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listingId))

    const childWrites: BatchItem<'pg'>[] = []
    if (data.locations) {
      childWrites.push(...(await buildLocationSync(listingId, data.locations)))
    }
    if (data.photos) {
      childWrites.push(...buildPhotoSync(listingId, data.photos))
    }

    // A single statement is already atomic; batch only when the multi-table
    // location/photo sync also rides along. `[parentUpdate, ...childWrites]` types
    // as a non-empty tuple, which is what db.batch requires.
    if (childWrites.length > 0) {
      await db.batch([parentUpdate, ...childWrites])
    } else {
      await parentUpdate
    }

    return { success: true, listingId }
  }

  // Enforce the "Selling Your Franchise" disclaimer server-side (DEBT-022). The
  // client gate reveals the wizard after acknowledgeSellingDisclaimer(), but a
  // seller could POST to the create action directly without ever passing the gate.
  // Only the create-new path is guarded; editing an existing listing (the
  // listingId branch above) is unaffected.
  if (!(await hasAcknowledgedCurrentFdd(user.id!))) {
    throw new Error('You must acknowledge the seller disclaimer before creating a listing.')
  }

  // Create new draft — all-or-nothing. The listing id is app-generated up front so
  // the parent row and its children share it without a cross-query dependency, then
  // the parent insert + every location/photo insert commit in ONE neon-http batch
  // (a single transaction). A mid-sequence failure can no longer leave a parent
  // listing with partial (or zero) locations/photos. Owner-directory resolution and
  // best-effort geocoding happen inside buildLocationInserts, before the batch opens.
  const newListingId = crypto.randomUUID()

  const locationInserts = data.locations
    ? await buildLocationInserts(newListingId, data.locations, new Map())
    : []
  const photoInserts = data.photos ? buildPhotoInserts(newListingId, data.photos) : []

  const listingInsert = db.insert(listings).values({
    id: newListingId,
    sellerId: user.id!,
    type,
    status: 'draft',
    title,
    ...buildListingUpdate(data),
  })

  await db.batch([listingInsert, ...locationInserts, ...photoInserts])

  return { success: true, listingId: newListingId }
}

export async function submitListing(listingId: string) {
  const user = await requireSellerAccess()

  const [listing] = await db.select()
    .from(listings)
    .where(eq(listings.id, listingId))

  if (!listing) throw new Error('Listing not found')
  if (listing.sellerId !== user.id && user.role !== 'admin') {
    throw new Error('Not authorized')
  }
  if (listing.status !== 'draft' && listing.status !== 'rejected') {
    throw new Error('Can only submit draft or rejected listings')
  }

  await db.update(listings)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(eq(listings.id, listingId))

  revalidatePath('/seller/listings')
  revalidatePath('/admin/queue')

  return { success: true }
}

export async function updateListing(listingId: string, data: Partial<ListingFormData>) {
  const user = await requireSellerAccess()

  const [listing] = await db.select()
    .from(listings)
    .where(eq(listings.id, listingId))

  if (!listing) throw new Error('Listing not found')
  if (listing.sellerId !== user.id && user.role !== 'admin') {
    throw new Error('Not authorized')
  }

  // Save the updates
  await saveDraft(data, listingId)

  // If rejected, auto-resubmit for review
  if (listing.status === 'rejected') {
    await db.update(listings)
      .set({
        status: 'pending',
        rejectionReason: null,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, listingId))
  }

  revalidatePath(`/seller/listings/${listingId}`)
  revalidatePath('/seller/listings')
  revalidatePath('/admin/queue')

  return { success: true }
}

export async function changeListingStatus(
  listingId: string,
  targetStatus: ListingStatus,
  reason?: string
) {
  const user = await requireSellerAccess()

  const [listing] = await db.select()
    .from(listings)
    .where(eq(listings.id, listingId))

  if (!listing) throw new Error('Listing not found')

  // The owner manages their own listing as a seller — even if they are also an
  // admin. (This is the seller-area action; admins approve/reject other people's
  // listings through the separate admin-queue path.) Non-owners must be admins.
  const ownsListing = listing.sellerId === user.id
  if (!ownsListing && user.role !== 'admin') {
    throw new Error('Not authorized')
  }
  const userRole: 'seller' | 'admin' = ownsListing ? 'seller' : 'admin'

  // Validate transition
  if (!canTransition(listing.status as ListingStatus, targetStatus, userRole)) {
    throw new Error(`Cannot transition from ${listing.status} to ${targetStatus}`)
  }

  await db.update(listings)
    .set({
      status: targetStatus,
      listedAt: nextListedAt(listing.listedAt ?? null, targetStatus, new Date()),
      rejectionReason: targetStatus === 'rejected' ? reason : null,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId))

  revalidatePath(`/seller/listings/${listingId}`)
  revalidatePath('/seller/listings')
  revalidatePath('/admin/queue')
  revalidatePath('/admin/listings')

  return { success: true }
}
