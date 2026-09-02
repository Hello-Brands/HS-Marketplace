"use server"

import { db } from "@/db"
import { users, allowlist } from "@/db/schema/auth"
import { eq, count } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth-guards"
import { parseAllowlistEntry } from "@/lib/auth/allowlist-entry"

export async function getUsers() {
  await requireAdmin()
  return db.select().from(users).orderBy(users.createdAt)
}

export async function getAllowlist() {
  await requireAdmin()
  return db.select().from(allowlist).orderBy(allowlist.addedAt)
}

export async function setUserRole(userId: string, role: "user" | "admin") {
  const currentUser = await requireAdmin()

  // Prevent last admin from demoting themselves
  if (role === "user" && userId === currentUser.id) {
    const adminCount = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.role, "admin"))

    if (adminCount[0].count <= 1) {
      throw new Error("Cannot demote the last admin")
    }
  }

  await db.update(users).set({ role }).where(eq(users.id, userId))
  revalidatePath("/admin/users")
}

export async function setSellerAccess(userId: string, sellerAccess: boolean) {
  await requireAdmin()
  await db.update(users).set({ sellerAccess }).where(eq(users.id, userId))
  revalidatePath("/admin/users")
}

/**
 * Add an individual address (`jane@partnerbrand.com`) or a whole company
 * (`@partnerbrand.com`) to the allowlist.
 *
 * Return contract: user-facing problems come back as `{ ok: false, error }`
 * rather than thrown, because Next.js redacts thrown server-action messages in
 * production — the admin would just see "an error occurred". `requireAdmin`
 * still throws: that is an auth failure, not user input.
 */
export async function addToAllowlist(
  raw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const currentUser = await requireAdmin()

  const parsed = parseAllowlistEntry(raw)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const { entry } = parsed

  const existing = await db.query.allowlist.findFirst({
    where: eq(allowlist.email, entry.value),
  })

  if (existing) {
    return {
      ok: false,
      error: entry.kind === "domain" ? "Domain already in allowlist" : "Email already in allowlist",
    }
  }

  await db.insert(allowlist).values({
    email: entry.value,
    addedBy: currentUser.id,
  })

  revalidatePath("/admin/users")
  return { ok: true }
}

export async function removeFromAllowlist(email: string) {
  await requireAdmin()
  // Trim as well as lowercase so a domain entry ("@partnerbrand.com") removes
  // cleanly no matter how the value reached us.
  await db.delete(allowlist).where(eq(allowlist.email, email.trim().toLowerCase()))
  revalidatePath("/admin/users")
}

export async function removeUser(userId: string) {
  const currentUser = await requireAdmin()

  if (userId === currentUser.id) {
    throw new Error("Cannot remove yourself")
  }

  // Prevent removing last admin
  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })

  if (targetUser?.role === "admin") {
    const adminCount = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.role, "admin"))

    if (adminCount[0].count <= 1) {
      throw new Error("Cannot remove the last admin")
    }
  }

  await db.delete(users).where(eq(users.id, userId))
  revalidatePath("/admin/users")
}
