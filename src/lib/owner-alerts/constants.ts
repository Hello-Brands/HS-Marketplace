/**
 * Owner closure alerts: constants shared by server code, client components,
 * and tests. MUST stay free of "server-only" imports.
 */

/** Default radius for auto-created owner closure alerts (spec: 3 miles). */
export const OWNER_AUTO_RADIUS_MILES = 3

export const OWNER_AUTO_ORIGIN = "owner-auto" as const

/** True for saved searches created and managed by the owner-alert reconciler. */
export function isOwnerAutoAlert(a: { origin: string | null | undefined }): boolean {
  return a.origin === OWNER_AUTO_ORIGIN
}
