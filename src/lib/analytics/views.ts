'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { listings } from '@/db/schema/listings'
import { listingViews } from '@/db/schema/listingViews'
import { eq, sql } from 'drizzle-orm'
import { shouldRecordView } from './helpers'

/**
 * Record a unique-per-day view of a listing. No-ops for guests, the listing's
 * own seller, and admins. Dedupes on (listing, viewer, UTC day) via the unique
 * index; bumps listings.viewCount only when a new row is actually inserted.
 */
export async function recordListingView(listingId: string): Promise<void> {
  const session = await auth()
  const viewerId = session?.user?.id
  if (!viewerId) return

  const [row] = await db
    .select({ sellerId: listings.sellerId })
    .from(listings)
    .where(eq(listings.id, listingId))
  if (!row) return

  if (!shouldRecordView({ viewerId, sellerId: row.sellerId, viewerRole: session.user.role ?? 'user' })) {
    return
  }

  const viewDate = new Date().toISOString().slice(0, 10) // UTC YYYY-MM-DD

  const inserted = await db
    .insert(listingViews)
    .values({ listingId, viewerId, viewDate })
    .onConflictDoNothing({
      target: [listingViews.listingId, listingViews.viewerId, listingViews.viewDate],
    })
    .returning({ id: listingViews.id })

  if (inserted.length > 0) {
    await db
      .update(listings)
      .set({ viewCount: sql`${listings.viewCount} + 1` })
      .where(eq(listings.id, listingId))
  }
}
