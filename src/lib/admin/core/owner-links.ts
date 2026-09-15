// src/lib/admin/core/owner-links.ts
/**
 * User ↔ owner link administration core — shared by
 * src/lib/owner-directory/actions.ts and the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. These functions take
 * a trusted `AdminActor` and do NOT check auth themselves. Do not re-export
 * them from a `"use server"` module and do not add `"use server"` here.
 */
import { revalidatePath } from "next/cache"
import { and, eq, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import { ownerLocations, userOwnerLinks } from "@/db/schema"
import { UNKNOWN_OWNER } from "@/lib/owner-directory/query"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

type LinkOutcome = { ok: true } | { ok: false; error: string }

/**
 * Upsert a link row. One row per (user, owner) — re-linking a previously
 * revoked owner flips the existing row instead of failing on the unique index.
 */
async function upsertLink(
  userId: string,
  ownerIdentifier: string,
  source: "manual" | "revoked",
  actorUserId: string,
): Promise<void> {
  await db
    .insert(userOwnerLinks)
    .values({ userId, ownerIdentifier, source, actorUserId })
    .onConflictDoUpdate({
      target: [userOwnerLinks.userId, userOwnerLinks.ownerIdentifier],
      set: { source, actorUserId, updatedAt: sql`now()` },
    })
}

function linkTargetId(userId: string, ownerIdentifier: string) {
  return `${userId}:${ownerIdentifier}`
}

/**
 * Link a user to an owner_identifier (source=manual). Manual links are never
 * overwritten by the automatic email match. The owner must exist in the
 * directory and not be the Unknown Owner bucket.
 */
export async function addOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string) {
  const { result, auditId } = await withAudit(
    actor,
    "owner_link.add",
    { type: "owner_link", id: linkTargetId(userId, ownerIdentifier) },
    { userId, ownerIdentifier },
    async (): Promise<LinkOutcome> => {
      if (ownerIdentifier === UNKNOWN_OWNER) {
        return { ok: false, error: "Unknown Owner cannot be assigned to a user" }
      }

      const exists = await db
        .select({ id: ownerLocations.id })
        .from(ownerLocations)
        .where(
          and(
            eq(ownerLocations.ownerIdentifier, ownerIdentifier),
            ne(ownerLocations.ownerIdentifier, UNKNOWN_OWNER),
          ),
        )
        .limit(1)
      if (exists.length === 0) {
        return { ok: false, error: `Unknown owner_identifier: ${ownerIdentifier}` }
      }

      await upsertLink(userId, ownerIdentifier, "manual", actor.userId)
      revalidatePath("/admin/owner-directory")
      return { ok: true }
    },
  )
  return { ...result, auditId }
}

/**
 * Revoke one owner profile for a user. Durable — the login matcher skips
 * revoked owners. Deliberately does NOT validate directory membership so an
 * orphaned link can still be cleaned up.
 */
export async function revokeOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string) {
  const { result, auditId } = await withAudit(
    actor,
    "owner_link.revoke",
    { type: "owner_link", id: linkTargetId(userId, ownerIdentifier) },
    { userId, ownerIdentifier },
    async (): Promise<LinkOutcome> => {
      await upsertLink(userId, ownerIdentifier, "revoked", actor.userId)
      revalidatePath("/admin/owner-directory")
      return { ok: true }
    },
  )
  return { ...result, auditId }
}

/**
 * Delete a link row outright: undoes a revocation or removes a manual link.
 */
export async function clearOwnerLink(actor: AdminActor, userId: string, ownerIdentifier: string) {
  const { result, auditId } = await withAudit(
    actor,
    "owner_link.clear",
    { type: "owner_link", id: linkTargetId(userId, ownerIdentifier) },
    { userId, ownerIdentifier },
    async (): Promise<LinkOutcome> => {
      await db
        .delete(userOwnerLinks)
        .where(
          and(
            eq(userOwnerLinks.userId, userId),
            eq(userOwnerLinks.ownerIdentifier, ownerIdentifier),
          ),
        )
      revalidatePath("/admin/owner-directory")
      return { ok: true }
    },
  )
  return { ...result, auditId }
}
