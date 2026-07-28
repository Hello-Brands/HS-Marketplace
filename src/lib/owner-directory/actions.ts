"use server"

import { revalidatePath } from "next/cache"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { ownerLocations, userOwnerLinks } from "@/db/schema"
import { syncOwnerLocations, type SyncResult } from "./sync"
import { UNKNOWN_OWNER } from "./query"
import { requireAdmin } from "@/lib/auth-guards"

type ActionResult = { ok: true } | { ok: false; error: string }

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
 * Upsert a link row. One row per (user, owner) — so re-linking a previously
 * revoked owner flips the existing row instead of failing on the unique index
 * or duplicating it. Idempotent: a double-click is harmless.
 */
async function upsertLink(
  userId: string,
  ownerIdentifier: string,
  source: "manual" | "revoked",
  actorUserId: string | null
): Promise<void> {
  await db
    .insert(userOwnerLinks)
    .values({ userId, ownerIdentifier, source, actorUserId })
    .onConflictDoUpdate({
      target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
      set: { source, actorUserId, updatedAt: sql`now()` },
    })
}

/**
 * Admin manual override: link a user to an owner_identifier (source=manual).
 * Manual links are never overwritten or removed by the automatic email match.
 * The owner must exist in the directory and not be the Unknown Owner bucket.
 */
export async function addOwnerLink(
  userId: string,
  ownerIdentifier: string
): Promise<ActionResult> {
  const admin = await requireAdmin()
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

  await upsertLink(userId, ownerIdentifier, "manual", admin.id ?? null)
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}

/**
 * Admin manual override: revoke one owner profile for a user. Durable — the
 * login matcher skips revoked owners, so this survives re-sync and re-login.
 *
 * Deliberately does NOT validate directory membership: revoking an orphaned
 * link (an identifier the sync has since dropped) is exactly the cleanup an
 * admin needs, and validating would block it.
 */
export async function revokeOwnerLink(
  userId: string,
  ownerIdentifier: string
): Promise<ActionResult> {
  const admin = await requireAdmin()
  await upsertLink(userId, ownerIdentifier, "revoked", admin.id ?? null)
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}

/**
 * Admin: delete a link row outright. Undoes a revocation (the owner becomes
 * eligible for automatic linking again on the user's next login) or removes a
 * manual link. Also does not validate directory membership.
 */
export async function clearOwnerLink(
  userId: string,
  ownerIdentifier: string
): Promise<ActionResult> {
  await requireAdmin()
  await db
    .delete(userOwnerLinks)
    .where(
      and(
        eq(userOwnerLinks.userId, userId),
        eq(userOwnerLinks.ownerIdentifier, ownerIdentifier)
      )
    )
  revalidatePath("/admin/owner-directory")
  return { ok: true }
}
