import "server-only"
import { and, asc, eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { alerts } from "@/db/schema/alerts"
import { users } from "@/db/schema/auth"
import { ownerLocations } from "@/db/schema"
import { getEffectiveOwnerIdentifiers } from "@/lib/owner-directory/links"
import { UNKNOWN_OWNER } from "@/lib/owner-directory/query"
import { seedCompetitorLedger } from "@/lib/competitor-alert-log"
import { planOwnerAutoAlerts } from "./plan"
import { OWNER_AUTO_RADIUS_MILES, OWNER_AUTO_ORIGIN } from "./constants"

/**
 * Mirror an opted-in user's owned salons into origin='owner-auto' saved
 * searches: create (ledger-seeded) for newly owned, refresh drifted coords,
 * delete for no-longer-owned. Runs in the login event and the opt-in action.
 * Never throws — a directory or DB hiccup must not block sign-in (same
 * contract as linkOwnerAtLogin).
 */
export async function reconcileOwnerAutoAlerts(userId: string): Promise<void> {
  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
    if (user?.ownerAlertsChoice !== "enabled") return

    const identifiers = (await getEffectiveOwnerIdentifiers(userId)).filter(
      (o) => o !== UNKNOWN_OWNER
    )

    const owned =
      identifiers.length === 0
        ? []
        : await db
            .select({
              ownerIdentifier: ownerLocations.ownerIdentifier,
              locationName: ownerLocations.blvdLocationName,
              latitude: ownerLocations.latitude,
              longitude: ownerLocations.longitude,
            })
            .from(ownerLocations)
            .where(inArray(ownerLocations.ownerIdentifier, identifiers))

    // Oldest first: the planner keeps the LAST row seen for a duplicated
    // (owner, location) pair, so a stable order makes which row survives —
    // and which get deleted — deterministic across runs.
    const existing = await db
      .select({
        id: alerts.id,
        ownerIdentifier: alerts.ownerIdentifier,
        ownerLocationName: alerts.ownerLocationName,
        centerLat: alerts.centerLat,
        centerLng: alerts.centerLng,
      })
      .from(alerts)
      .where(and(eq(alerts.userId, userId), eq(alerts.origin, OWNER_AUTO_ORIGIN)))
      .orderBy(asc(alerts.createdAt))

    const plan = planOwnerAutoAlerts(owned, existing)

    for (const c of plan.toCreate) {
      const [row] = await db
        .insert(alerts)
        .values({
          userId,
          origin: OWNER_AUTO_ORIGIN,
          ownerIdentifier: c.ownerIdentifier,
          ownerLocationName: c.locationName,
          name: c.locationName,
          centerLat: c.latitude,
          centerLng: c.longitude,
          radiusMiles: OWNER_AUTO_RADIUS_MILES,
          centerLabel: c.locationName,
          includeListings: false,
          includeCompetitors: true,
        })
        .returning({ id: alerts.id })
      // Seed so closures that pre-date the opt-in never email.
      await seedCompetitorLedger(row.id, {
        centerLat: c.latitude,
        centerLng: c.longitude,
        radiusMiles: OWNER_AUTO_RADIUS_MILES,
        states: [],
      })
    }

    for (const u of plan.toUpdate) {
      // Coords + label only — never touch `name` (the user may have renamed it)
      // or `notifyEnabled` (their kill switch).
      await db
        .update(alerts)
        .set({ centerLat: u.latitude, centerLng: u.longitude, centerLabel: u.locationName })
        .where(eq(alerts.id, u.id))
    }

    if (plan.toDelete.length > 0) {
      // competitor_alert_log rows cascade with the alert.
      await db.delete(alerts).where(inArray(alerts.id, plan.toDelete))
    }
  } catch (err) {
    console.warn("[owner-alerts] reconcile failed (non-fatal):", err)
  }
}
