import { isWithinRadius } from "./geo"
import type { CompetitorScope } from "./competitor-filter"

/** owner_locations date fields needed to decide whether a location is open. */
export interface HsLocationOpenDates {
  actualSuiteGoDate: Date | null
  suiteClosedDate: Date | null
  actualFlagshipGoDate: Date | null
  flagshipClosedDate: Date | null
}

/** A map dot for an open Hello Sugar location that is NOT listed for sale. */
export interface UnlistedHsLocation {
  id: string
  name: string
  city: string | null
  state: string | null
  latitude: number
  longitude: number
  openedSince: number | null
}

/** A track (suite or flagship) is live if it has gone and hasn't since closed. */
function trackOpen(goDate: Date | null, closedDate: Date | null, now: Date): boolean {
  if (!goDate || goDate.getTime() > now.getTime()) return false
  if (closedDate && closedDate.getTime() <= now.getTime()) return false
  return true
}

/** Open on EITHER the suite or the flagship track. */
export function isLocationOpen(dates: HsLocationOpenDates, now: Date): boolean {
  return (
    trackOpen(dates.actualSuiteGoDate, dates.suiteClosedDate, now) ||
    trackOpen(dates.actualFlagshipGoDate, dates.flagshipClosedDate, now)
  )
}

/** Year of the earliest actual go-date (suite or flagship); null if neither set. */
export function openedSinceYear(dates: HsLocationOpenDates): number | null {
  const times = [dates.actualSuiteGoDate, dates.actualFlagshipGoDate]
    .filter((x): x is Date => x != null)
    .map((x) => x.getTime())
  if (times.length === 0) return null
  return new Date(Math.min(...times)).getUTCFullYear()
}

/** One dot per physical location: prefer the blvd number, else the normalized name. */
export function locationDedupeKey(row: {
  blvdLocationNumber: string | null
  blvdLocationName: string
}): string {
  const num = row.blvdLocationNumber?.trim()
  if (num) return `num:${num}`
  return `name:${row.blvdLocationName.trim().toLowerCase()}`
}

/**
 * Not listed = the resolved BigQuery name is not among the active listings' bq
 * names. An unresolved (null) name cannot match, so it counts as not listed.
 */
export function isNotListed(
  resolvedBqLocationName: string | null,
  activeListedBqNames: Set<string>
): boolean {
  if (!resolvedBqLocationName) return true
  return !activeListedBqNames.has(resolvedBqLocationName)
}

/** Scope test mirroring competitorInScope; a null state fails an active state filter. */
export function hsLocationInScope(
  loc: { latitude: number; longitude: number; state: string | null },
  scope: CompetitorScope
): boolean {
  if (scope.states && scope.states.length > 0) {
    if (!loc.state || !scope.states.includes(loc.state)) return false
  }
  if (scope.centerLat != null && scope.centerLng != null && scope.radiusMiles != null) {
    if (
      !isWithinRadius(scope.centerLat, scope.centerLng, loc.latitude, loc.longitude, scope.radiusMiles)
    ) {
      return false
    }
  }
  return true
}
