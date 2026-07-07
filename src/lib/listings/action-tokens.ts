import { SignJWT, jwtVerify } from 'jose'
import { db } from '@/db'
import { listings } from '@/db/schema/listings'
import { eq } from 'drizzle-orm'
import { canTransition } from './status-machine'
import type { ListingStatus } from './types'

const getSecret = () => new TextEncoder().encode(process.env.ACTION_TOKEN_SECRET)

export type ActionType = 'markSold' | 'confirmActive'

// DEBT-017: shortened from 7d to 72h to narrow the replay window on forwarded
// action emails, while still giving a seller a few days to click a reminder.
// These tokens are NOT yet single-use — true single-use needs a consumed-nonce
// store (a schema change); replay is currently bounded by canTransition (a
// re-played markSold is a no-op once the listing is sold) and confirmActive is
// idempotent. Tracked as the remaining half of DEBT-017.
export async function createActionToken(
  action: ActionType,
  listingId: string,
  expiresIn: string = '72h'
): Promise<string> {
  const token = await new SignJWT({ action, listingId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret())

  return token
}

export async function verifyActionToken(token: string): Promise<{
  success: boolean
  message: string
  action?: ActionType
  listingId?: string
}> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    const { action, listingId } = payload as { action: ActionType; listingId: string }

    return { success: true, message: 'Valid token', action, listingId }
  } catch {
    return { success: false, message: 'Invalid or expired link' }
  }
}

export async function executeAction(token: string): Promise<{
  success: boolean
  message: string
}> {
  const verification = await verifyActionToken(token)
  if (!verification.success) {
    return verification
  }

  const { action, listingId } = verification

  const listing = await db.query.listings.findFirst({
    where: eq(listings.id, listingId!),
  })

  if (!listing) {
    return { success: false, message: 'Listing not found' }
  }

  if (action === 'markSold') {
    if (!canTransition(listing.status as ListingStatus, 'sold', 'seller')) {
      return { success: false, message: 'Listing cannot be marked as sold from current status' }
    }

    await db.update(listings)
      .set({ status: 'sold', updatedAt: new Date() })
      .where(eq(listings.id, listingId!))

    return { success: true, message: 'Listing marked as sold' }
  }

  if (action === 'confirmActive') {
    // Reset reminder timer so next reminder is sent 30 days from now
    await db.update(listings)
      .set({ lastReminderSent: null, updatedAt: new Date() })
      .where(eq(listings.id, listingId!))

    return { success: true, message: 'Listing confirmed as still active' }
  }

  return { success: false, message: 'Unknown action' }
}
