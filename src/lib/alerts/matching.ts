/**
 * Alert matching + fan-out for newly approved listings.
 *
 * This module is deliberately NOT a `"use server"` file. Every export of a
 * `"use server"` module is reachable as an unauthenticated POST endpoint (the
 * action ids ship in the client bundle), and `triggerAlertMatching` sends an
 * unbounded fan-out of email — so exposing it as an action made a mass-mail
 * trigger and an alert-match-count oracle callable by anyone. It is only ever
 * invoked server-side from the admin approval flow, so it lives here instead,
 * where it has no action id and cannot be addressed from outside.
 *
 * Keep it that way: do not re-export this from a `"use server"` module, and do
 * not add `"use server"` to this file — either would recreate the endpoint.
 */

import { db } from "@/db"
import { alerts } from "@/db/schema/alerts"
import { users } from "@/db/schema/auth"
import { eq } from "drizzle-orm"
import { sendAlertMatchEmail } from "@/lib/email"
import { listingMatchesAlert } from "@/lib/alert-match"

type MatchLocation = {
  state: string | null
  latitude: number | null
  longitude: number | null
  territoryLat: number | null
  territoryLng: number | null
  openingDate: Date | null
}

export type MatchListing = {
  id: string
  type: string
  city: string | null
  state: string | null
  askingPrice: number | null
  inventoryIncluded?: boolean
  locationName: string | null
  locations?: MatchLocation[]
}

/**
 * Trigger alert matching for a newly approved listing.
 *
 * INTEGRATION POINT: called from the listing approval action when a listing
 * status changes to 'active' (see `approveListing` in src/lib/admin/actions.ts,
 * which gates on `requireAdmin()` first).
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
