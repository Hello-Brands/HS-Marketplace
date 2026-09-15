/**
 * Listing moderation core — shared by the admin server actions
 * (src/lib/admin/actions.ts) and the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. Every export of a
 * `"use server"` module is reachable as an unauthenticated POST endpoint; these
 * functions take a trusted `AdminActor` and do NOT check auth themselves. Do
 * not re-export them from a `"use server"` module and do not add `"use server"`
 * to this file.
 */
import { db } from '@/db'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'
import { eq, desc } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { revalidatePath } from 'next/cache'
import { sendStatusChangeEmail } from '@/lib/email'
import { canTransition } from '@/lib/listings/status-machine'
import { nextListedAt } from '@/lib/analytics/helpers'
import { unresolvedSalonLocations } from '@/lib/data/mapping'
import { triggerAlertMatching } from '@/lib/alerts/matching'
import { buildListingUpdate } from '@/lib/listings/build-update'
import { parseListingPatch } from '@/lib/listings/schemas'
import { buildLocationSync, buildPhotoSync } from '@/lib/listings/persist'
import type { ListingStatus, ListingFormData } from '@/lib/listings/types'
import { withAudit } from '@/lib/admin/audit'
import type { AdminActor } from './actor'

export async function getPendingListings() {
  return db.query.listings.findMany({
    where: eq(listings.status, 'pending'),
    orderBy: [desc(listings.createdAt)],
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder], limit: 1 },
      seller: true,
    },
  })
}

export async function getAllListings(statusFilter?: ListingStatus) {
  const conditions = statusFilter ? eq(listings.status, statusFilter) : undefined
  return db.query.listings.findMany({
    where: conditions,
    orderBy: [desc(listings.createdAt)],
    with: {
      locations: { orderBy: [listingLocations.displayOrder] },
      photos: { orderBy: [listingPhotos.displayOrder], limit: 1 },
      seller: true,
    },
  })
}

function revalidateListing(listingId: string) {
  revalidatePath('/admin/queue')
  revalidatePath('/admin/listings')
  revalidatePath(`/seller/listings/${listingId}`)
}

export async function approveListing(actor: AdminActor, listingId: string) {
  const { result, auditId } = await withAudit(
    actor,
    'listing.approve',
    { type: 'listing', id: listingId },
    { listingId },
    async () => {
      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, listingId),
        with: { seller: true },
      })

      if (!listing) throw new Error('Listing not found')

      if (!canTransition(listing.status as ListingStatus, 'active', 'admin')) {
        throw new Error(`Cannot approve listing with status ${listing.status}`)
      }

      // A listing cannot go active until every salon location's data-source mapping
      // is resolved (confirmed or explicitly not_connected). Wrong/blank mappings
      // would leak the wrong location's financials.
      const mapLocs = await db
        .select({
          id: listingLocations.id,
          name: listingLocations.name,
          locationType: listingLocations.locationType,
          dataMappingStatus: listingLocations.dataMappingStatus,
        })
        .from(listingLocations)
        .where(eq(listingLocations.listingId, listingId))
      const blocking = unresolvedSalonLocations(mapLocs)
      if (blocking.length > 0) {
        throw new Error(`Confirm data mapping for: ${blocking.map((b) => b.name).join(", ")}`)
      }

      await db.update(listings)
        .set({
          status: 'active',
          listedAt: nextListedAt(listing.listedAt ?? null, 'active', new Date()),
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(listings.id, listingId))

      if (listing.seller?.email) {
        await sendStatusChangeEmail({
          recipientEmail: listing.seller.email,
          recipientName: listing.seller.name || 'Seller',
          listingTitle: listing.title || 'Your listing',
          listingId: listing.id,
          newStatus: 'active',
        })
      }

      // Trigger alert emails for buyers with matching alert criteria
      const locations = await db.query.listingLocations.findMany({
        where: eq(listingLocations.listingId, listingId),
      })
      const primary = locations.find((l) => l.displayOrder === 0) ?? locations[0]

      await triggerAlertMatching({
        id: listing.id,
        type: listing.type,
        city: primary?.city ?? null,
        state: primary?.state ?? null,
        askingPrice: listing.askingPrice,
        inventoryIncluded: listing.inventoryIncluded,
        locationName: primary?.name ?? listing.title ?? null,
        locations: locations.map((l) => ({
          state: l.state,
          latitude: l.latitude,
          longitude: l.longitude,
          territoryLat: l.territoryLat,
          territoryLng: l.territoryLng,
          openingDate: l.openingDate,
        })),
      })

      revalidateListing(listingId)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}

export async function rejectListing(actor: AdminActor, listingId: string, reason: string, notes?: string) {
  const { result, auditId } = await withAudit(
    actor,
    'listing.reject',
    { type: 'listing', id: listingId },
    { listingId, reason, notes },
    async () => {
      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, listingId),
        with: { seller: true },
      })

      if (!listing) throw new Error('Listing not found')

      if (!canTransition(listing.status as ListingStatus, 'rejected', 'admin')) {
        throw new Error(`Cannot reject listing with status ${listing.status}`)
      }

      const fullReason = notes ? `${reason}: ${notes}` : reason

      await db.update(listings)
        .set({
          status: 'rejected',
          rejectionReason: fullReason,
          updatedAt: new Date(),
        })
        .where(eq(listings.id, listingId))

      if (listing.seller?.email) {
        await sendStatusChangeEmail({
          recipientEmail: listing.seller.email,
          recipientName: listing.seller.name || 'Seller',
          listingTitle: listing.title || 'Your listing',
          listingId: listing.id,
          newStatus: 'rejected',
          rejectionReason: fullReason,
        })
      }

      revalidateListing(listingId)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}

export async function adminUpdateListing(
  actor: AdminActor,
  listingId: string,
  input: Partial<ListingFormData>,
) {
  const { result, auditId } = await withAudit(
    actor,
    'listing.update',
    { type: 'listing', id: listingId },
    { listingId, fields: Object.keys(input) },
    async () => {
      // Validate server-side — the zod schemas were wired only into the client
      // resolver, so nothing enforced types, ranges or max lengths on a direct
      // action invocation. Parsed output strips unknown keys.
      const data = parseListingPatch(input)

      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, listingId),
      })

      if (!listing) throw new Error('Listing not found')

      // Generate title from locations if provided; admin keeps the existing title otherwise.
      const title = data.locations?.map(l => l.name).join(' + ') || listing.title

      // Atomic edit (DEBT-027): parent update + location/photo delete-reinserts commit
      // in ONE neon-http batch. Async resolution (owner directory + geocode) runs
      // inside buildLocationSync BEFORE the batch is composed.
      const parentUpdate = db.update(listings)
        .set({
          title,
          ...buildListingUpdate(data, listing),
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

      if (childWrites.length > 0) {
        await db.batch([parentUpdate, ...childWrites])
      } else {
        await parentUpdate
      }

      revalidateListing(listingId)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}

export async function adminMarkSold(actor: AdminActor, listingId: string) {
  const { result, auditId } = await withAudit(
    actor,
    'listing.mark_sold',
    { type: 'listing', id: listingId },
    { listingId },
    async () => {
      const listing = await db.query.listings.findFirst({
        where: eq(listings.id, listingId),
      })

      if (!listing) throw new Error('Listing not found')

      if (!canTransition(listing.status as ListingStatus, 'sold', 'admin')) {
        throw new Error(`Cannot mark listing as sold from status ${listing.status}`)
      }

      await db.update(listings)
        .set({
          status: 'sold',
          updatedAt: new Date(),
        })
        .where(eq(listings.id, listingId))

      revalidateListing(listingId)
      return { success: true as const }
    },
  )
  return { ...result, auditId }
}
