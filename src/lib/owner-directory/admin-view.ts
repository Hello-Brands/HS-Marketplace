import type { OwnerLinkSource } from "@/db/schema"
import { isEffectiveLinkSource } from "./link"

export type AdminOwnerLink = {
  ownerIdentifier: string
  source: OwnerLinkSource
}

export type AdminUserRow = {
  id: string
  name: string | null
  email: string | null
  links: AdminOwnerLink[]
}

/** One row per (user, link) as the left join returns it; nulls when unlinked. */
export type FlatUserLinkRow = {
  id: string
  name: string | null
  email: string | null
  ownerIdentifier: string | null
  source: OwnerLinkSource | null
}

/**
 * Collapse a left-joined user/link result into one row per user. User order is
 * preserved from the query (which orders by email); links are sorted by
 * identifier so chip order does not shift between renders.
 */
export function groupUserLinkRows(rows: FlatUserLinkRow[]): AdminUserRow[] {
  const byUser = new Map<string, AdminUserRow>()
  for (const row of rows) {
    let user = byUser.get(row.id)
    if (!user) {
      user = { id: row.id, name: row.name, email: row.email, links: [] }
      byUser.set(row.id, user)
    }
    if (row.ownerIdentifier !== null && row.source !== null) {
      user.links.push({ ownerIdentifier: row.ownerIdentifier, source: row.source })
    }
  }
  for (const user of byUser.values()) {
    user.links.sort((a, b) => a.ownerIdentifier.localeCompare(b.ownerIdentifier))
  }
  return [...byUser.values()]
}

/** Badge variant per link state. Revoked reads as muted, not as an error. */
export function linkSourceBadgeVariant(
  source: OwnerLinkSource
): "default" | "primary" | "outline" {
  if (source === "manual") return "primary"
  if (source === "revoked") return "outline"
  return "default"
}

/** How many users hold two or more effective owner profiles. */
export function countMultiLinkUsers(rows: AdminUserRow[]): number {
  return rows.filter(
    (r) => r.links.filter((l) => isEffectiveLinkSource(l.source)).length >= 2
  ).length
}

/** A directory row with no coordinates — it cannot be drawn on the map. */
export type UngeocodedLocation = {
  id: string
  blvdLocationName: string
  locationAddress: string | null
}

/**
 * Directory rows that have no coordinates.
 *
 * The /browse map plots only geocoded rows, so each of these is INVISIBLE
 * there — with no error, no empty state, nothing. That silence is the problem:
 * an owner asking "why can't I see my location?" is usually looking at one of
 * these, and the only way anyone found out was an owner complaining. Surfacing
 * the list in admin turns a silent gap into something someone can act on.
 *
 * Deliberately not a separate query — the admin page already selects every
 * column of every directory row, so this is a filter over data in hand.
 */
export function findUngeocodedLocations(
  rows: {
    id: string
    blvdLocationName: string
    locationAddress: string | null
    latitude: number | null
    longitude: number | null
  }[]
): UngeocodedLocation[] {
  return rows
    .filter((r) => r.latitude === null || r.longitude === null)
    .map((r) => ({
      id: r.id,
      blvdLocationName: r.blvdLocationName,
      locationAddress: r.locationAddress,
    }))
}

/**
 * Owners the admin can still add for this user. A revoked owner stays
 * offered — re-linking one is a normal correction.
 */
export function addableOwners<T extends { ownerIdentifier: string }>(
  all: T[],
  links: AdminOwnerLink[]
): T[] {
  const held = new Set(
    links.filter((l) => isEffectiveLinkSource(l.source)).map((l) => l.ownerIdentifier)
  )
  return all.filter((o) => !held.has(o.ownerIdentifier))
}
