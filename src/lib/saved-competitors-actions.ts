'use server'

import { auth } from '@/auth'
import { db } from '@/db'
import { savedCompetitors } from '@/db/schema/savedCompetitors'
import { and, eq } from 'drizzle-orm'
import type { SavedCompetitorInput } from '@/lib/saved-competitors'

export async function toggleSavedCompetitor(
  input: SavedCompetitorInput,
): Promise<{ saved: boolean }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  const userId = session.user.id

  const existing = await db.query.savedCompetitors.findFirst({
    where: and(
      eq(savedCompetitors.userId, userId),
      eq(savedCompetitors.placeId, input.placeId),
    ),
  })

  if (existing) {
    await db.delete(savedCompetitors).where(
      and(
        eq(savedCompetitors.userId, userId),
        eq(savedCompetitors.placeId, input.placeId),
      ),
    )
    return { saved: false }
  }

  await db.insert(savedCompetitors).values({
    userId,
    placeId: input.placeId,
    brandName: input.brandName,
    address: input.address,
    city: input.city,
    state: input.state,
    // numeric columns take strings (driver convention)
    lat: String(input.lat),
    lng: String(input.lng),
    businessStatus: input.businessStatus,
    mapsUrl: input.mapsUrl,
  })
  return { saved: true }
}

export async function getSavedCompetitorPlaceIds(): Promise<string[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const rows = await db.query.savedCompetitors.findMany({
    where: eq(savedCompetitors.userId, session.user.id),
    columns: { placeId: true },
  })
  return rows.map((r) => r.placeId)
}
