import "server-only"
import { and, asc, eq, ilike, inArray, ne, or, type SQL } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { ownerLocations, type OwnerLocation } from "@/db/schema"
import { UNKNOWN_OWNER } from "./query"
import { getEffectiveOwnerIdentifiers } from "./links"

/**
 * The logged-in user's owned locations, scoped in the QUERY (not just the UI):
 * we read the user's own effective owner links from the DB and only ever
 * return rows for those owners. A user may hold several owner profiles, so
 * this is a merged set, ordered by location name — owner_identifier is
 * internal bookkeeping and never surfaces in owner-facing UI.
 *
 * Returns an empty result when the user isn't a linked owner. Unknown Owner is
 * never returned even if somehow linked.
 */
export async function getMyOwnerLocations(): Promise<{
  ownerIdentifiers: string[]
  locations: OwnerLocation[]
}> {
  const session = await auth()
  if (!session?.user?.id) return { ownerIdentifiers: [], locations: [] }

  const linked = await getEffectiveOwnerIdentifiers(session.user.id)
  const ownerIdentifiers = linked.filter((o) => o !== UNKNOWN_OWNER)

  // Explicit early return rather than relying on inArray(col, []) emitting a
  // false predicate — this is a security boundary, not a convenience.
  if (ownerIdentifiers.length === 0) return { ownerIdentifiers: [], locations: [] }

  const locations = await db
    .select()
    .from(ownerLocations)
    .where(inArray(ownerLocations.ownerIdentifier, ownerIdentifiers))
    .orderBy(asc(ownerLocations.blvdLocationName))

  return { ownerIdentifiers, locations }
}

async function requireAdminSession() {
  const session = await auth()
  if (!session?.user) throw new Error("Not authenticated")
  if (session.user.role !== "admin") throw new Error("Admin access required")
  return session.user
}

/** Admin-only: the full directory, optionally filtered by a search term. */
export async function getOwnerDirectory(search?: string): Promise<OwnerLocation[]> {
  await requireAdminSession()

  const term = search?.trim()
  const where: SQL | undefined = term
    ? or(
        ilike(ownerLocations.ownerIdentifier, `%${term}%`),
        ilike(ownerLocations.ownerName, `%${term}%`),
        ilike(ownerLocations.ownerContactEmail, `%${term}%`),
        ilike(ownerLocations.blvdLocationName, `%${term}%`)
      )
    : undefined

  return db
    .select()
    .from(ownerLocations)
    .where(where)
    .orderBy(asc(ownerLocations.ownerIdentifier), asc(ownerLocations.blvdLocationName))
}

/** Admin-only: distinct, linkable owners (excludes Unknown Owner) for the override picker. */
export async function listLinkableOwners(): Promise<{ ownerIdentifier: string; ownerName: string | null }[]> {
  await requireAdminSession()
  const rows = await db
    .selectDistinct({
      ownerIdentifier: ownerLocations.ownerIdentifier,
      ownerName: ownerLocations.ownerName,
    })
    .from(ownerLocations)
    .where(ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER))
    .orderBy(asc(ownerLocations.ownerIdentifier))
  return rows
}

/** Admin-only: users with their current owner link, for the manual override panel. */
export async function listUsersWithLinks(): Promise<
  {
    id: string
    name: string | null
    email: string | null
    ownerIdentifier: string | null
    ownerLinkSource: "auto" | "manual" | null
  }[]
> {
  await requireAdminSession()
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      ownerIdentifier: users.ownerIdentifier,
      ownerLinkSource: users.ownerLinkSource,
    })
    .from(users)
    .orderBy(asc(users.email))
}
