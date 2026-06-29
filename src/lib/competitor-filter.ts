import { isWithinRadius } from "./geo"

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
 * True if the competitor satisfies the scope's state set (when any) AND its
 * radius (when a full center+radius is set). No geo and no states → always true.
 */
export function competitorInScope(c: ScopedCompetitor, scope: CompetitorScope): boolean {
  if (scope.states && scope.states.length > 0) {
    if (!scope.states.includes(c.state)) return false
  }
  if (scope.centerLat != null && scope.centerLng != null && scope.radiusMiles != null) {
    if (!isWithinRadius(scope.centerLat, scope.centerLng, c.latitude, c.longitude, scope.radiusMiles)) {
      return false
    }
  }
  return true
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

export function selectUnloggedCompetitors<T extends { googlePlaceId: string }>(
  inScope: T[],
  loggedPlaceIds: Set<string>
): T[] {
  return inScope.filter((c) => !loggedPlaceIds.has(c.googlePlaceId))
}
