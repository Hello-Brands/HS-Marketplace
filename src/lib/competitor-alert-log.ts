import "server-only"
import { db } from "@/db"
import { competitorAlertLog } from "@/db/schema/competitorAlertLog"
import { eq } from "drizzle-orm"
import { getCompetitorClosures } from "./competitor-query"
import { scopeIsBounded, type CompetitorScope } from "./competitor-filter"

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
 * Baseline-seed a saved search's ledger with every closure currently in scope,
 * WITHOUT emailing — so the first weekly run never blasts pre-existing
 * closures. No-op when the scope can't narrow competitors.
 */
export async function seedCompetitorLedger(alertId: string, scope: CompetitorScope): Promise<void> {
  if (!scopeIsBounded(scope)) return
  const inScope = await getCompetitorClosures(scope)
  await recordCompetitorAlerts(alertId, inScope.map((c) => c.googlePlaceId))
}
