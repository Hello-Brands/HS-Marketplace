"use server"

/**
 * Alert Actions - Server Actions for buyer listing alerts
 *
 * ALERT CRITERIA: State/region only (per user decision in CONTEXT.md)
 * Alerts match on listing.state being in alert.states array.
 * Type and price filters are NOT part of alert criteria.
 *
 * Alert matching + email fan-out on approval lives in
 * `src/lib/alerts/matching.ts` (deliberately not a "use server" module — see
 * the note at the bottom of this file).
 */

import { auth } from "@/auth"
import { db } from "@/db"
import { alerts, type NewAlert } from "@/db/schema/alerts"
import { eq, desc } from "drizzle-orm"
import { z } from "zod"
import { revalidatePath } from "next/cache"
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

/**
 * Single source of truth for the alert filter columns. Both `toRow` (the insert
 * mapping) and `updateAlert` (the patch builder) iterate this one list, so a new
 * alert field is added in exactly one place — avoiding the two-list drift that
 * caused the historical cents bug.
 *
 * - `default`: value substituted when the input value is null/undefined.
 * - `patchRaw`: when true, `updateAlert` stores the provided value AS-IS without
 *   applying `default`. This preserves `notifyEnabled`'s original patch semantics
 *   (it was the only field assigned raw in the update, while `toRow` still
 *   applies its `true` default on insert).
 */
const ALERT_FIELDS: ReadonlyArray<{
  key: keyof AlertInput
  default: unknown
  patchRaw?: boolean
}> = [
  { key: "name", default: null },
  { key: "query", default: null },
  { key: "states", default: [] },
  { key: "listingTypes", default: [] },
  { key: "minPrice", default: null },
  { key: "maxPrice", default: null },
  { key: "minYearsOpen", default: null },
  { key: "inventoryIncluded", default: false },
  { key: "sort", default: null },
  { key: "centerLat", default: null },
  { key: "centerLng", default: null },
  { key: "radiusMiles", default: null },
  { key: "centerLabel", default: null },
  { key: "notifyEnabled", default: true, patchRaw: true },
  { key: "includeListings", default: true },
  { key: "includeCompetitors", default: true },
]

function toRow(data: AlertInput) {
  const row: Record<string, unknown> = {}
  for (const { key, default: fallback } of ALERT_FIELDS) {
    row[key] = data[key] ?? fallback
  }
  return row as unknown as Omit<NewAlert, "id" | "userId" | "createdAt" | "updatedAt">
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
  for (const { key, default: fallback, patchRaw } of ALERT_FIELDS) {
    if (key in d) {
      patch[key] = patchRaw ? d[key] : d[key] ?? fallback
    }
  }

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

// `triggerAlertMatching` used to live here. It moved to
// `src/lib/alerts/matching.ts` — a plain module, NOT a "use server" one —
// because every export of a "use server" file is reachable as an
// unauthenticated POST endpoint, and this one sends an unbounded email
// fan-out. Do not re-export it from here; that would recreate the endpoint.
