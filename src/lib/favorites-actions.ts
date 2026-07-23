'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { favorites } from '@/db/schema/favorites'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function toggleFavorite(listingId: string): Promise<{ favorited: boolean }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const existing = await db.query.favorites.findFirst({
    where: and(
      eq(favorites.userId, session.user.id),
      eq(favorites.listingId, listingId),
    ),
  })

  if (existing) {
    await db.delete(favorites).where(
      and(
        eq(favorites.userId, session.user.id),
        eq(favorites.listingId, listingId),
      ),
    )
    revalidatePath(`/listings/${listingId}`)
    return { favorited: false }
  }

  await db.insert(favorites).values({
    userId: session.user.id,
    listingId,
  })
  revalidatePath(`/listings/${listingId}`)
  return { favorited: true }
}

export async function getFavoriteListingIds(): Promise<string[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const rows = await db.query.favorites.findMany({
    where: eq(favorites.userId, session.user.id),
    columns: { listingId: true },
  })
  return rows.map((r) => r.listingId)
}

export async function isFavorited(listingId: string): Promise<boolean> {
  const session = await auth()
  if (!session?.user?.id) return false

  const existing = await db.query.favorites.findFirst({
    where: and(
      eq(favorites.userId, session.user.id),
      eq(favorites.listingId, listingId),
    ),
  })
  return !!existing
}
