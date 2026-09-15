// src/lib/admin/core/users.ts
/**
 * User administration core — shared by src/app/admin/users/actions.ts and the
 * MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. These functions take
 * a trusted `AdminActor` and do NOT check auth themselves. Do not re-export
 * them from a `"use server"` module and do not add `"use server"` here.
 */
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { eq, count } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

export async function getUsers() {
  return db.select().from(users).orderBy(users.createdAt)
}

/**
 * How many admins exist. Exported so the MCP destructive tools can run the same
 * last-admin refusal as a PREVIEW pre-check, before a confirmation token is minted
 * (spec §7.5). A read: it grants no power the caller did not already have.
 */
export async function adminCount(): Promise<number> {
  const rows = await db.select({ count: count() }).from(users).where(eq(users.role, "admin"))
  return rows[0].count
}

export async function setUserRole(actor: AdminActor, userId: string, role: "user" | "admin") {
  const { auditId } = await withAudit(
    actor,
    "user.set_role",
    { type: "user", id: userId },
    { userId, role },
    async () => {
      // Prevent last admin from demoting themselves
      if (role === "user" && userId === actor.userId) {
        if ((await adminCount()) <= 1) {
          throw new Error("Cannot demote the last admin")
        }
      }
      await db.update(users).set({ role }).where(eq(users.id, userId))
      revalidatePath("/admin/users")
    },
  )
  return { auditId }
}

export async function setSellerAccess(actor: AdminActor, userId: string, sellerAccess: boolean) {
  const { auditId } = await withAudit(
    actor,
    "user.set_seller_access",
    { type: "user", id: userId },
    { userId, sellerAccess },
    async () => {
      await db.update(users).set({ sellerAccess }).where(eq(users.id, userId))
      revalidatePath("/admin/users")
    },
  )
  return { auditId }
}

export async function removeUser(actor: AdminActor, userId: string) {
  const { auditId } = await withAudit(
    actor,
    "user.remove",
    { type: "user", id: userId },
    { userId },
    async () => {
      if (userId === actor.userId) {
        throw new Error("Cannot remove yourself")
      }

      // Prevent removing last admin
      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, userId),
      })

      if (targetUser?.role === "admin") {
        if ((await adminCount()) <= 1) {
          throw new Error("Cannot remove the last admin")
        }
      }

      await db.delete(users).where(eq(users.id, userId))
      revalidatePath("/admin/users")
    },
  )
  return { auditId }
}
