"use server"

import { auth } from "@/auth"
import { revalidatePath } from "next/cache"
import { and, eq, ne } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { ownerLocations } from "@/db/schema"
import { syncOwnerLocations, type SyncResult } from "./sync"
import { UNKNOWN_OWNER } from "./query"

async function requireAdmin() {
  const session = await auth()
  if (!session?.user) throw new Error("Not authenticated")
  if (session.user.role !== "admin") throw new Error("Admin access required")
  return session.user
}

/** Admin-only "refresh now" trigger for the owner directory sync. */
export async function refreshOwnerDirectory(): Promise<
  { ok: true; result: SyncResult } | { ok: false; error: string }
> {
  await requireAdmin()
  try {
    const result = await syncOwnerLocations()
    revalidatePath("/admin/owner-directory")
    return { ok: true, result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "sync failed" }
  }
}

/**
 * Admin manual override: link a user to an owner_identifier (source=manual).
 * Manual links are never overwritten by the automatic email match. The owner
 * must exist in the directory and not be the Unknown Owner bucket.
 */
export async function manuallyLinkUser(
  userId: string,
  ownerIdentifier: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin()
  if (ownerIdentifier === UNKNOWN_OWNER) {
    return { ok: false, error: "Unknown Owner cannot be assigned to a user" }
  }

  const exists = await db
    .select({ id: ownerLocations.id })
    .from(ownerLocations)
    .where(
      and(
        eq(ownerLocations.ownerIdentifier, ownerIdentifier),
        ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER)
      )
    )
    .limit(1)
  if (exists.length === 0) {
    return { ok: false, error: `Unknown owner_identifier: ${ownerIdentifier}` }
  }

  await db
    .update(users)
    .set({ ownerIdentifier, ownerLinkSource: "manual" })
    .where(eq(users.id, userId))
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}

/**
 * Admin manual override: unlink a user. Keeps source=manual (sticky) so the
 * automatic email match won't re-link them on next login.
 */
export async function manuallyUnlinkUser(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin()
  await db
    .update(users)
    .set({ ownerIdentifier: null, ownerLinkSource: "manual" })
    .where(eq(users.id, userId))
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}

/**
 * Admin: clear an override so the user becomes eligible for automatic linking
 * again on their next login.
 */
export async function resetUserLink(
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin()
  await db
    .update(users)
    .set({ ownerIdentifier: null, ownerLinkSource: null })
    .where(eq(users.id, userId))
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}
