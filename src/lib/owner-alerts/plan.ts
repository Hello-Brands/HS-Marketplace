/**
 * Pure planning for the owner-auto alert reconciler: given the user's owned
 * salons and their existing owner-auto alerts, decide creates/updates/deletes.
 * Keyed on the (owner_identifier, blvd_location_name) soft reference — the
 * owner_locations table full-refresh syncs, so row ids are NOT stable.
 * Server-only-free so it unit-tests without mocks.
 */

export interface OwnedLocationInput {
  ownerIdentifier: string
  locationName: string // owner_locations.blvd_location_name
  latitude: number | null
  longitude: number | null
}

export interface OwnerAutoAlertInput {
  id: string
  ownerIdentifier: string | null
  ownerLocationName: string | null
  centerLat: number | null
  centerLng: number | null
}

export interface OwnerAlertPlan {
  toCreate: Array<{ ownerIdentifier: string; locationName: string; latitude: number; longitude: number }>
  toUpdate: Array<{ id: string; latitude: number; longitude: number; locationName: string }>
  toDelete: string[]
}

const pairKey = (ownerIdentifier: string, locationName: string) =>
  `${ownerIdentifier} ${locationName}`

export function planOwnerAutoAlerts(
  owned: OwnedLocationInput[],
  existing: OwnerAutoAlertInput[]
): OwnerAlertPlan {
  const ownedByKey = new Map<string, OwnedLocationInput>()
  for (const loc of owned) ownedByKey.set(pairKey(loc.ownerIdentifier, loc.locationName), loc)

  const toCreate: OwnerAlertPlan["toCreate"] = []
  const toUpdate: OwnerAlertPlan["toUpdate"] = []
  const toDelete: string[] = []

  const existingByKey = new Map<string, OwnerAutoAlertInput>()
  for (const a of existing) {
    // A malformed row (soft reference lost) can't be reconciled — remove it.
    if (!a.ownerIdentifier || !a.ownerLocationName) {
      toDelete.push(a.id)
      continue
    }
    const k = pairKey(a.ownerIdentifier, a.ownerLocationName)
    if (!ownedByKey.has(k)) {
      toDelete.push(a.id) // no longer effectively owned (revoked / removed)
      continue
    }
    existingByKey.set(k, a)
  }

  for (const [k, loc] of ownedByKey) {
    const ex = existingByKey.get(k)
    if (!ex) {
      // Un-geocoded locations are skipped; the reconciler picks them up once
      // the directory geocodes them.
      if (loc.latitude != null && loc.longitude != null) {
        toCreate.push({
          ownerIdentifier: loc.ownerIdentifier,
          locationName: loc.locationName,
          latitude: loc.latitude,
          longitude: loc.longitude,
        })
      }
      continue
    }
    // Refresh drifted coords. A location that LOST its coords keeps the old
    // (still valid) center rather than being deleted.
    if (
      loc.latitude != null &&
      loc.longitude != null &&
      (ex.centerLat !== loc.latitude || ex.centerLng !== loc.longitude)
    ) {
      toUpdate.push({ id: ex.id, latitude: loc.latitude, longitude: loc.longitude, locationName: loc.locationName })
    }
  }

  return { toCreate, toUpdate, toDelete }
}
