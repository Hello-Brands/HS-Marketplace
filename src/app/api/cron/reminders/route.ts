import { NextResponse } from 'next/server'
import { db } from '@/db'
import { listings } from '@/db/schema/listings'
import { users } from '@/db/schema/auth'
import { eq, and, lt, or, isNull } from 'drizzle-orm'
import { sendReminderEmail } from '@/lib/email'
import { createActionToken } from '@/lib/listings/action-tokens'
import { env } from '@/lib/env'

export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized invocations
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  // Find active listings that haven't had a reminder in 30+ days
  // and haven't been updated in 30+ days (to avoid reminding on recently updated listings)
  const listingsToRemind = await db
    .select({
      listing: listings,
      seller: users,
    })
    .from(listings)
    .innerJoin(users, eq(listings.sellerId, users.id))
    .where(
      and(
        eq(listings.status, 'active'),
        or(
          isNull(listings.lastReminderSent),
          lt(listings.lastReminderSent, thirtyDaysAgo)
        ),
        lt(listings.updatedAt, thirtyDaysAgo)
      )
    )

  let sent = 0
  for (const { listing, seller } of listingsToRemind) {
    if (!seller.email) continue

    const markSoldToken = await createActionToken('markSold', listing.id)
    const appUrl = env.NEXT_PUBLIC_APP_URL || 'https://marketplace.hellosugar.salon'
    const markSoldUrl = `${appUrl}/api/actions/${markSoldToken}`

    const daysSinceUpdate = Math.floor(
      (Date.now() - listing.updatedAt.getTime()) / (24 * 60 * 60 * 1000)
    )

    // Send reminder with one-click mark-sold link embedded in email
    await sendReminderEmail({
      sellerEmail: seller.email,
      sellerName: seller.name || 'Seller',
      listingTitle: listing.title || 'Your listing',
      listingId: listing.id,
      daysSinceUpdate,
      markSoldUrl,
    })

    // Update lastReminderSent timestamp
    await db.update(listings)
      .set({ lastReminderSent: new Date() })
      .where(eq(listings.id, listing.id))

    sent++
  }

  return NextResponse.json({ success: true, sent })
}
