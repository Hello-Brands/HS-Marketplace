import { isWithinRadius } from "./geo"
import { isOwnerAutoAlert } from "./owner-alerts/constants"

export interface CompetitorScope {
  centerLat?: number | null
  centerLng?: number | null
  radiusMiles?: number | null
  states?: string[]
}

/** Minimal shape needed to test a competitor against a scope. */
export interface ScopedCompetitor {
  googlePlaceId: string
  latitude: number
  longitude: number
  state: string
}

/**
 * True if a point satisfies the scope's state set (when any) AND its radius
 * (when a full center+radius is set). No geo and no states → always true. A
 * null state fails an active state filter. Shared by competitor and unlisted-HS
 * location filtering (DEBT-029).
 */
export function pointInScope(
  point: { latitude: number; longitude: number; state: string | null },
  scope: CompetitorScope,
): boolean {
  if (scope.states && scope.states.length > 0) {
    if (!point.state || !scope.states.includes(point.state)) return false
  }
  if (scope.centerLat != null && scope.centerLng != null && scope.radiusMiles != null) {
    if (!isWithinRadius(scope.centerLat, scope.centerLng, point.latitude, point.longitude, scope.radiusMiles)) {
      return false
    }
  }
  return true
}

/** A competitor's state is always present, so this is `pointInScope` on a competitor. */
export function competitorInScope(c: ScopedCompetitor, scope: CompetitorScope): boolean {
  return pointInScope(c, scope)
}

export function filterCompetitorsByScope<T extends ScopedCompetitor>(
  list: T[],
  scope: CompetitorScope
): T[] {
  return list.filter((c) => competitorInScope(c, scope))
}

/** True when the scope can actually narrow competitors (has full geo or states). */
export function scopeIsBounded(scope: CompetitorScope): boolean {
  const hasGeo =
    scope.centerLat != null && scope.centerLng != null && scope.radiusMiles != null
  const hasStates = !!(scope.states && scope.states.length > 0)
  return hasGeo || hasStates
}

/**
 * Which closures an alert may match. Owner-auto alerts fire on permanent
 * closures only (spec decision); regular saved searches keep both types.
 */
export function eligibleClosuresForAlert<T extends { businessStatus: string }>(
  alert: { origin: string | null | undefined },
  closures: T[]
): T[] {
  return isOwnerAutoAlert(alert)
    ? closures.filter((c) => c.businessStatus === "CLOSED_PERMANENTLY")
    : closures
}

export function selectUnloggedCompetitors<T extends { googlePlaceId: string }>(
  inScope: T[],
  loggedPlaceIds: Set<string>
): T[] {
  return inScope.filter((c) => !loggedPlaceIds.has(c.googlePlaceId))
}
