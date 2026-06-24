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

  await db
    .update(alerts)
    .set({ ...toRow(parsed.data), updatedAt: new Date() })
    .where(eq(alerts.id, id))

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

/**
 * Trigger alert matching for a newly approved listing.
 *
 * INTEGRATION POINT: This function should be called from the listing
 * approval action in Phase 2 when a listing status changes to 'active'.
 *
 * Matching logic: Alert matches if listing.state is in alert.states array,
 * OR if alert.states is empty (matches all states).
 *
 * Example usage in listing approval action:
 * ```typescript
 * // After setting listing.status = 'active'
 * await triggerAlertMatching({
 *   id: listing.id,
 *   type: listing.type,
 *   city: listing.city,
 *   state: listing.state,
 *   askingPrice: listing.askingPrice,
 *   locationName: listing.locationName,
 * })
 * ```
 *
 * @param listing - The listing that was just approved
 * @returns Object with count of matched alerts
 */
export async function triggerAlertMatching(listing: {
  id: string
  type: string
  city: string | null
  state: string | null
  askingPrice: number | null
  locationName: string | null
}) {
  // Find all alerts joined with user info (STATE ONLY matching)
  const allAlerts = await db
    .select({
      alert: alerts,
      user: users,
    })
    .from(alerts)
    .innerJoin(users, eq(alerts.userId, users.id))

  const matchingAlerts = allAlerts.filter(({ alert }) => {
    // State match: if alert has states, listing.state must be in the list
    // If alert.states is empty/null, it matches ALL states
    if (alert.states && alert.states.length > 0) {
      if (!listing.state || !alert.states.includes(listing.state)) {
        return false
      }
    }

    // NO type or price matching per CONTEXT.md decision
    return true
  })

  // Send emails to all matching alerts
  await Promise.all(
    matchingAlerts.map(({ alert, user }) =>
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
