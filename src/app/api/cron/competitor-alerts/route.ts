import { NextResponse } from "next/server"
import { db } from "@/db"
import { alerts } from "@/db/schema/alerts"
import { users } from "@/db/schema/auth"
import { eq } from "drizzle-orm"
import { getCompetitorClosures } from "@/lib/competitor-query"
import {
  eligibleClosuresForAlert,
  filterCompetitorsByScope,
  selectUnloggedCompetitors,
  scopeIsBounded,
} from "@/lib/competitor-filter"
import { isOwnerAutoAlert } from "@/lib/owner-alerts/constants"
import { getLoggedCompetitorPlaceIds, recordCompetitorAlerts } from "@/lib/competitor-alert-log"
import { sendCompetitorAlertEmail } from "@/lib/email"
import { savedSearchToBrowseParams } from "@/lib/saved-search"
import { env } from "@/lib/env"

export async function GET(request: Request) {
  // Verify cron secret to prevent unauthorized invocations
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // The closure set is small — fetch once, filter per saved search in memory.
  const allCompetitors = await getCompetitorClosures()
  const rows = await db
    .select({ alert: alerts, user: users })
    .from(alerts)
    .innerJoin(users, eq(alerts.userId, users.id))

  const appUrl = env.NEXT_PUBLIC_APP_URL || "https://marketplace.hellosugar.salon"
  let processed = 0
  let emailed = 0
  let errors = 0

  for (const { alert, user } of rows) {
    if (!alert.notifyEnabled || !alert.includeCompetitors) continue
    if (!user.email) continue
    const scope = {
      centerLat: alert.centerLat,
      centerLng: alert.centerLng,
      radiusMiles: alert.radiusMiles,
      states: alert.states ?? [],
    }
    if (!scopeIsBounded(scope)) continue // unscoped search → would match every closure
    processed++

    try {
      // Owner-auto alerts fire on permanent closures only.
      const pool = eligibleClosuresForAlert(alert, allCompetitors)
      const inScope = filterCompetitorsByScope(pool, scope)
      const logged = await getLoggedCompetitorPlaceIds(alert.id)
      const fresh = selectUnloggedCompetitors(inScope, logged)
      if (fresh.length === 0) continue

      const res = await sendCompetitorAlertEmail({
        buyerEmail: user.email,
        buyerName: user.name || "Hello Sugar Buyer",
        searchName: alert.name || alert.centerLabel || "your saved search",
        searchUrl: `${appUrl}/browse?${savedSearchToBrowseParams(alert)}&showCompetitors=true`,
        variant: isOwnerAutoAlert(alert) ? "owner-location" : "saved-search",
        competitors: fresh.map((c) => ({
          brandName: c.brandName,
          city: c.city,
          state: c.state,
          nearestHsName: c.nearestHsName,
          nearestHsMiles: c.nearestHsMiles,
          mapsUrl: c.mapsUrl,
        })),
      })

      // Record only after a successful send, so a failed/skipped send retries
      // next week rather than being silently marked as handled.
      if (res.success) {
        await recordCompetitorAlerts(alert.id, fresh.map((c) => c.googlePlaceId))
        emailed++
      } else {
        console.warn(`[competitor-alerts] send not confirmed for alert ${alert.id}`)
      }
    } catch (err) {
      console.error(`[competitor-alerts] alert ${alert.id} failed`, err)
      errors++
    }
  }

  return NextResponse.json({ success: true, processed, emailed, errors })
}
