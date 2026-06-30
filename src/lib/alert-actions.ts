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
import { listingMatchesAlert } from "@/lib/alert-match"
import { getCompetitorClosures } from "@/lib/competitor-query"
import { scopeIsBounded } from "@/lib/competitor-filter"
import { recordCompetitorAlerts } from "@/lib/competitor-alert-log"

const alertSchema = z.object({
  name: z.string().max(120).optional().nullable(),
  query: z.string().max(200).optional().nullable(),
  states: z.array(z.string()).optional(),
  listingTypes: z.array(z.string()).optional(),
  minPrice: z.number().int().nonnegative().optional().nullable(),
  maxPrice: z.number().int().nonnegative().optional().nullable(),
  minYearsOpen: z.number().int().nonnegative().optional().nullable(),
  inventoryIncluded: z.boolean().optional(),
  sort: z.string().max(40).optional().nullable(),
  centerLat: z.number().min(-90).max(90).optional().nullable(),
  centerLng: z.number().min(-180).max(180).optional().nullable(),
  radiusMiles: z.number().int().positive().max(500).optional().nullable(),
  centerLabel: z.string().max(200).optional().nullable(),
  notifyEnabled: z.boolean().optional(),
  includeListings: z.boolean().optional(),
  includeCompetitors: z.boolean().optional(),
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
    inventoryIncluded: data.inventoryIncluded ?? false,
    sort: data.sort ?? null,
    centerLat: data.centerLat ?? null,
    centerLng: data.centerLng ?? null,
    radiusMiles: data.radiusMiles ?? null,
    centerLabel: data.centerLabel ?? null,
    notifyEnabled: data.notifyEnabled ?? true,
    includeListings: data.includeListings ?? true,
    includeCompetitors: data.includeCompetitors ?? true,
  }
}

/**
 * Seed the competitor ledger with all competitors currently in a saved search's
 * scope, WITHOUT emailing — so the first weekly cron run doesn't blast every
 * pre-existing closure. No-op when the scope can't narrow competitors.
 */
async function seedCompetitorLog(
  alertId: string,
  scope: { centerLat: number | null; centerLng: number | null; radiusMiles: number | null; states: string[] }
) {
  if (!scopeIsBounded(scope)) return
  const inScope = await getCompetitorClosures(scope)
  await recordCompetitorAlerts(alertId, inScope.map((c) => c.googlePlaceId))
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

  if (alert.includeCompetitors) {
    await seedCompetitorLog(alert.id, {
      centerLat: alert.centerLat,
      centerLng: alert.centerLng,
      radiusMiles: alert.radiusMiles,
      states: alert.states ?? [],
    })
  }

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
  if ("inventoryIncluded" in d) patch.inventoryIncluded = d.inventoryIncluded ?? false
  if ("sort" in d) patch.sort = d.sort ?? null
  if ("centerLat" in d) patch.centerLat = d.centerLat ?? null
  if ("centerLng" in d) patch.centerLng = d.centerLng ?? null
  if ("radiusMiles" in d) patch.radiusMiles = d.radiusMiles ?? null
  if ("centerLabel" in d) patch.centerLabel = d.centerLabel ?? null
  if ("notifyEnabled" in d) patch.notifyEnabled = d.notifyEnabled
  if ("includeListings" in d) patch.includeListings = d.includeListings ?? true
  if ("includeCompetitors" in d) patch.includeCompetitors = d.includeCompetitors ?? true

  await db.update(alerts).set(patch).where(eq(alerts.id, id))

  const turnedCompetitorsOn =
    existing.includeCompetitors === false && patch.includeCompetitors === true
  if (turnedCompetitorsOn) {
    await seedCompetitorLog(id, {
      centerLat: (patch.centerLat as number | null | undefined) ?? existing.centerLat,
      centerLng: (patch.centerLng as number | null | undefined) ?? existing.centerLng,
      radiusMiles: (patch.radiusMiles as number | null | undefined) ?? existing.radiusMiles,
      states: ((patch.states as string[] | undefined) ?? existing.states) ?? [],
    })
  }

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

  const now = new Date()
  const matchingAlerts = allAlerts.filter(({ alert }) =>
    listingMatchesAlert(alert, listing, locations, now)
  )

  const sendResults = await Promise.all(
    matchingAlerts.map(({ user }) =>
      sendAlertMatchEmail({
        buyerEmail: user.email!,
        buyerName: user.name || "Hello Sugar Buyer",
        listingTitle: listing.locationName || `${listing.city}, ${listing.state}`,
        listingId: listing.id,
        listingType: listing.type,
        city: listing.city || "",
        state: listing.state || "",
        askingPrice: listing.askingPrice ?? 0,
      }),
    ),
  )

  const failed = sendResults.filter((r) => !r.success).length
  if (failed > 0) {
    console.error(
      `[alerts] ${failed}/${sendResults.length} alert emails failed for listing ${listing.id}`
    )
  }

  return { matched: matchingAlerts.length, sent: sendResults.length - failed, failed }
}
