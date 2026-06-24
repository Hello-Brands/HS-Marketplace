"use server"

/**
 * Alert Actions - Server Actions for buyer listing alerts
 *
 * ALERT CRITERIA: State/region only (per user decision in CONTEXT.md)
 * Alerts match on listing.state being in alert.states array.
 * Type and price filters are NOT part of alert criteria.
 *
 * PHASE 2 INTEGRATION REQUIRED:
 * The `triggerAlertMatching` function must be called from the listing
 * approval Server Action (when admin approves a listing and status
 * changes to 'active'). This is the point where alert emails are sent.
 */

import { auth } from "@/auth"
import { db } from "@/db"
import { alerts } from "@/db/schema/alerts"
import { users } from "@/db/schema/auth"
import { eq, desc } from "drizzle-orm"
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { sendAlertMatchEmail } from "@/lib/email"
import { isWithinRadius } from "@/lib/geo"

const alertSchema = z.object({
  name: z.string().max(120).optional().nullable(),
  query: z.string().max(200).optional().nullable(),
  states: z.array(z.string()).optional(),
  listingTypes: z.array(z.string()).optional(),
  minPrice: z.number().int().nonnegative().optional().nullable(),
  maxPrice: z.number().int().nonnegative().optional().nullable(),
  minYearsOpen: z.number().int().nonnegative().optional().nullable(),
  sort: z.string().max(40).optional().nullable(),
  centerLat: z.number().min(-90).max(90).optional().nullable(),
  centerLng: z.number().min(-180).max(180).optional().nullable(),
  radiusMiles: z.number().int().positive().max(500).optional().nullable(),
  centerLabel: z.string().max(200).optional().nullable(),
  notifyEnabled: z.boolean().optional(),
})

type AlertInput = z.infer<typeof alertSchema>

function toRow(data: AlertInput) {
  return {
    name: data.name ?? null,
    query: data.query ?? null,
    states: data.states ?? [],
    listingTypes: data.listingTypes ?? [],
    minPrice: data.minPrice ?? null,
    maxPrice: data.maxPrice ?? null,
    minYearsOpen: data.minYearsOpen ?? null,
    sort: data.sort ?? null,
    centerLat: data.centerLat ?? null,
    centerLng: data.centerLng ?? null,
    radiusMiles: data.radiusMiles ?? null,
    centerLabel: data.centerLabel ?? null,
    notifyEnabled: data.notifyEnabled ?? true,
  }
}

export async function createAlert(data: AlertInput) {
  const session = await auth()
  if (!session?.user) return { error: "Not authenticated" }

  const parsed = alertSchema.safeParse(data)
  if (!parsed.success) return { error: "Invalid data" }

  const [alert] = await db
    .insert(alerts)
    .values({ userId: session.user.id!, ...toRow(parsed.data) })
    .returning()

  revalidatePath("/account/alerts")
  return { success: true, alert }
}

export async function updateAlert(id: string, data: AlertInput) {
  const session = await auth()
  if (!session?.user) return { error: "Not authenticated" }

  const existing = await db.query.alerts.findFirst({ where: eq(alerts.id, id) })
  if (!existing || existing.userId !== session.user.id) return { error: "Alert not found" }

  const parsed = alertSchema.safeParse(data)
  if (!parsed.success) return { error: "Invalid data" }

  // Only overwrite keys present in the input; leave the rest of the saved search intact.
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  const d = parsed.data
  if ("name" in d) patch.name = d.name ?? null
  if ("query" in d) patch.query = d.query ?? null
  if ("states" in d) patch.states = d.states ?? []
  if ("listingTypes" in d) patch.listingTypes = d.listingTypes ?? []
  if ("minPrice" in d) patch.minPrice = d.minPrice ?? null
  if ("maxPrice" in d) patch.maxPrice = d.maxPrice ?? null
  if ("minYearsOpen" in d) patch.minYearsOpen = d.minYearsOpen ?? null
  if ("sort" in d) patch.sort = d.sort ?? null
  if ("centerLat" in d) patch.centerLat = d.centerLat ?? null
  if ("centerLng" in d) patch.centerLng = d.centerLng ?? null
  if ("radiusMiles" in d) patch.radiusMiles = d.radiusMiles ?? null
  if ("centerLabel" in d) patch.centerLabel = d.centerLabel ?? null
  if ("notifyEnabled" in d) patch.notifyEnabled = d.notifyEnabled

  await db.update(alerts).set(patch).where(eq(alerts.id, id))
  revalidatePath("/account/alerts")
  return { success: true }
}

export async function deleteAlert(id: string) {
  const session = await auth()
  if (!session?.user) return { error: "Not authenticated" }

  const existing = await db.query.alerts.findFirst({
    where: eq(alerts.id, id),
  })
  if (!existing || existing.userId !== session.user.id) {
    return { error: "Alert not found" }
  }

  await db.delete(alerts).where(eq(alerts.id, id))

  revalidatePath("/account/alerts")
  return { success: true }
}

export async function getMyAlerts() {
  const session = await auth()
  if (!session?.user) return []

  return db.query.alerts.findMany({
    where: eq(alerts.userId, session.user.id!),
    orderBy: desc(alerts.createdAt),
  })
}

type MatchLocation = {
  state: string | null
  latitude: number | null
  longitude: number | null
  territoryLat: number | null
  territoryLng: number | null
  openingDate: Date | null
}

type MatchListing = {
  id: string
  type: string
  city: string | null
  state: string | null
  askingPrice: number | null
  locationName: string | null
  locations?: MatchLocation[]
}

/**
 * Trigger alert matching for a newly approved listing.
 *
 * INTEGRATION POINT: This function should be called from the listing
 * approval action when a listing status changes to 'active'.
 *
 * Matching logic ANDs across all set criteria:
 * - notifyEnabled: skip if false
 * - states: listing.state must be in alert.states (empty = any)
 * - listingTypes: listing.type must be in alert.listingTypes (empty = any)
 * - minPrice/maxPrice: listing.askingPrice (cents) must be in range
 * - minYearsOpen: at least one location open long enough
 * - radius: at least one location within radiusMiles of centerLat/centerLng
 * - query and sort are intentionally NOT matched
 *
 * @param listing - The listing that was just approved
 * @returns Object with count of matched alerts
 */
export async function triggerAlertMatching(listing: MatchListing) {
  const locations = listing.locations ?? []

  const allAlerts = await db
    .select({ alert: alerts, user: users })
    .from(alerts)
    .innerJoin(users, eq(alerts.userId, users.id))

  const matchingAlerts = allAlerts.filter(({ alert }) => {
    if (alert.notifyEnabled === false) return false

    // State (primary listing state) — empty/null = any
    if (alert.states && alert.states.length > 0) {
      if (!listing.state || !alert.states.includes(listing.state)) return false
    }
    // Type — empty/null = any
    if (alert.listingTypes && alert.listingTypes.length > 0) {
      if (!alert.listingTypes.includes(listing.type)) return false
    }
    // Price (cents)
    if (alert.minPrice != null && (listing.askingPrice == null || listing.askingPrice < alert.minPrice)) return false
    if (alert.maxPrice != null && (listing.askingPrice == null || listing.askingPrice > alert.maxPrice)) return false
    // Min years open — at least one location open long enough
    if (alert.minYearsOpen != null && alert.minYearsOpen > 0) {
      const cutoff = new Date()
      cutoff.setFullYear(cutoff.getFullYear() - alert.minYearsOpen)
      const ok = locations.some((l) => l.openingDate != null && l.openingDate <= cutoff)
      if (!ok) return false
    }
    // Radius — at least one location within radius of the saved center
    if (alert.centerLat != null && alert.centerLng != null && alert.radiusMiles != null) {
      const ok = locations.some((l) => {
        const lat = l.latitude ?? l.territoryLat
        const lng = l.longitude ?? l.territoryLng
        return lat != null && lng != null &&
          isWithinRadius(alert.centerLat!, alert.centerLng!, lat, lng, alert.radiusMiles!)
      })
      if (!ok) return false
    }
    // query and sort are intentionally NOT matched
    return true
  })

  await Promise.all(
    matchingAlerts.map(({ user }) =>
      sendAlertMatchEmail({
        buyerEmail: user.email!,
        buyerName: user.name || "Hello Sugar Buyer",
        listingTitle: listing.locationName || `${listing.city}, ${listing.state}`,
        listingId: listing.id,
        listingType: listing.type,
        city: listing.city || "",
        state: listing.state || "",
        askingPrice: listing.askingPrice || 0,
      }),
    ),
  )

  return { matched: matchingAlerts.length }
}
