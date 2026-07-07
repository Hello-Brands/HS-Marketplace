'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { contacts } from '@/db/schema/contacts'
import { listings } from '@/db/schema/listings'
import { sendContactNotification } from '@/lib/email'
import { checkRateLimit } from '@/lib/rate-limit'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const contactFormSchema = z.object({
  listingId: z.string().uuid(),
  message: z.string().optional(),
  phone: z.string().optional(),
})

export async function submitContactForm(prevState: unknown, formData: FormData) {
  const session = await auth()
  if (!session?.user) return { error: 'Not authenticated' }

  // Throttle per buyer (DEBT-028): each submit emails a seller, so cap bursts to
  // prevent a signed-in buyer from spamming sellers. Best-effort per-instance.
  const limit = checkRateLimit(`contact:${session.user.id}`, 5, 60_000)
  if (!limit.allowed) {
    return { error: 'You are sending messages too quickly. Please wait a moment and try again.' }
  }

  const parsed = contactFormSchema.safeParse({
    listingId: formData.get('listingId'),
    message: formData.get('message') || undefined,
    phone: formData.get('phone') || undefined,
  })
  if (!parsed.success) return { error: 'Invalid form data' }

  // Fetch listing with seller info
  const listing = await db.query.listings.findFirst({
    where: and(
      eq(listings.id, parsed.data.listingId),
      eq(listings.status, 'active'),
    ),
    with: { seller: true },
  })
  if (!listing) return { error: 'Listing not found' }

  // Record the inquiry first so the team can always see it (admin inquiries view),
  // even if notifying the seller fails below. Buyers may reach out more than once.
  await db.insert(contacts).values({
    listingId: parsed.data.listingId,
    buyerId: session.user.id!,
    message: parsed.data.message,
    buyerName: session.user.name ?? null,
    buyerEmail: session.user.email ?? null,
    buyerPhone: parsed.data.phone ?? null,
  })

  // Notify the seller. sendEmail returns the outcome rather than throwing, so we
  // must inspect it: a real send failure is surfaced to the buyer; an intentional
  // skip (no API key / non-production) is treated as success.
  const emailResult = await sendContactNotification({
    sellerEmail: listing.seller.email!,
    sellerName: listing.seller.name ?? 'Seller',
    buyerName: session.user.name ?? 'A buyer',
    buyerEmail: session.user.email!,
    listingTitle: listing.title ?? `${listing.seller.name ?? 'Location'}`,
    listingId: listing.id,
    message: parsed.data.message,
  })

  if (!emailResult.success && !('skipped' in emailResult)) {
    console.error(
      `[contact] Failed to notify seller for listing ${listing.id}:`,
      emailResult.error,
    )
    return {
      error: "We couldn't notify the seller right now. Please try again in a moment.",
    }
  }

  return { success: true }
}

export async function hasContactedListing(listingId: string): Promise<boolean> {
  const session = await auth()
  if (!session?.user) return false

  const existing = await db.query.contacts.findFirst({
    where: and(
      eq(contacts.listingId, listingId),
      eq(contacts.buyerId, session.user.id!),
    ),
  })
  return !!existing
}
