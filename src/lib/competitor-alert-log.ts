import "server-only"
import { db } from "@/db"
import { competitorAlertLog } from "@/db/schema/competitorAlertLog"
import { eq } from "drizzle-orm"

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
