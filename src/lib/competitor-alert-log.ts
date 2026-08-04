import "server-only"
import { db } from "@/db"
import { competitorAlertLog } from "@/db/schema/competitorAlertLog"
import { eq } from "drizzle-orm"
import { getCompetitorClosures } from "./competitor-query"
import {
  eligibleClosuresForAlert,
  scopeIsBounded,
  type CompetitorScope,
} from "./competitor-filter"

/** Place IDs already logged (emailed or baseline-seeded) for a saved search. */
export async function getLoggedCompetitorPlaceIds(alertId: string): Promise<Set<string>> {
  const rows = await db
    .select({ placeId: competitorAlertLog.googlePlaceId })
    .from(competitorAlertLog)
    .where(eq(competitorAlertLog.alertId, alertId))
  return new Set(rows.map((r) => r.placeId))
}

/** Record competitors as accounted-for for a saved search (idempotent). */
export async function recordCompetitorAlerts(
  alertId: string,
  googlePlaceIds: string[]
): Promise<void> {
  if (googlePlaceIds.length === 0) return
  await db
    .insert(competitorAlertLog)
    .values(googlePlaceIds.map((googlePlaceId) => ({ alertId, googlePlaceId })))
    .onConflictDoNothing()
}

/**
 * Baseline-seed a saved search's ledger with every closure currently in scope
 * THAT THE ALERT COULD EMAIL, WITHOUT emailing — so the first weekly run never
 * blasts pre-existing closures. No-op when the scope can't narrow competitors.
 *
 * The seed pool must mirror the cron's eligibility filter exactly: owner-auto
 * alerts only ever email permanent closures, so seeding their temporary ones
 * would burn the (alert_id, google_place_id) ledger key and permanently
 * suppress the notification when that competitor later closes for good.
 */
export async function seedCompetitorLedger(
  alertId: string,
  scope: CompetitorScope,
  alert: { origin: string | null } = { origin: "user" }
): Promise<void> {
  if (!scopeIsBounded(scope)) return
  const inScope = await getCompetitorClosures(scope)
  await recordCompetitorAlerts(
    alertId,
    eligibleClosuresForAlert(alert, inScope).map((c) => c.googlePlaceId)
  )
}
