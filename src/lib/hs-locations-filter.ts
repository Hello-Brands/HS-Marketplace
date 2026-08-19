import { pointInScope } from "./competitor-filter"
import type { CompetitorScope } from "./competitor-filter"

/**
 * owner_locations date fields needed to decide whether a location is open.
 *
 * Values may arrive as Date objects (a direct Drizzle read) OR as ISO strings:
 * getUnlistedHsLocations reads these through unstable_cache, whose serialization
 * turns timestamp columns into strings. Both forms are accepted and coerced via
 * `toDate` so the date math below never calls .getTime() on a string.
 */
export interface HsLocationOpenDates {
  actualSuiteGoDate: Date | string | null
  suiteClosedDate: Date | string | null
  actualFlagshipGoDate: Date | string | null
  flagshipClosedDate: Date | string | null
}

/** Coerce a possibly-serialized timestamp to a Date; null passes through. */
function toDate(value: Date | string | null): Date | null {
  if (value == null) return null
  return value instanceof Date ? value : new Date(value)
}

/** Which track(s) a location currently operates: suite, flagship, or both. */
export type HsLocationType = "suite" | "flagship" | "both"

/** A map dot for an open Hello Sugar location that is NOT listed for sale. */
export interface UnlistedHsLocation {
  id: string
  name: string
  city: string | null
  state: string | null
  latitude: number
  longitude: number
  openedSince: number | null
  locationType: HsLocationType | null
}

/** A track (suite or flagship) is live if it has gone and hasn't since closed. */
function trackOpen(goDateInput: Date | string | null, closedDateInput: Date | string | null, now: Date): boolean {
  const goDate = toDate(goDateInput)
  const closedDate = toDate(closedDateInput)
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

/** Type from the currently OPEN tracks; null when neither is open right now. */
export function locationType(dates: HsLocationOpenDates, now: Date): HsLocationType | null {
  const suite = trackOpen(dates.actualSuiteGoDate, dates.suiteClosedDate, now)
  const flagship = trackOpen(dates.actualFlagshipGoDate, dates.flagshipClosedDate, now)
  if (suite && flagship) return "both"
  if (suite) return "suite"
  if (flagship) return "flagship"
  return null
}

/** Year of the earliest actual go-date (suite or flagship); null if neither set. */
export function openedSinceYear(dates: HsLocationOpenDates): number | null {
  const times = [dates.actualSuiteGoDate, dates.actualFlagshipGoDate]
    .map(toDate)
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

/** Scope test for an unlisted HS location — shared with competitors via pointInScope. */
export function hsLocationInScope(
  loc: { latitude: number; longitude: number; state: string | null },
  scope: CompetitorScope
): boolean {
  return pointInScope(loc, scope)
}
