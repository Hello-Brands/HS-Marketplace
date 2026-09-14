// src/lib/admin/core/allowlist.ts
/**
 * Allowlist administration core — shared by src/app/admin/users/actions.ts
 * and the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. These functions take
 * a trusted `AdminActor` and do NOT check auth themselves. Do not re-export
 * them from a `"use server"` module and do not add `"use server"` here.
 */
import { db } from "@/db"
import { allowlist } from "@/db/schema/auth"
import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { parseAllowlistEntry } from "@/lib/auth/allowlist-entry"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

export async function getAllowlist() {
  return db.select().from(allowlist).orderBy(allowlist.addedAt)
}

/**
 * Add an individual address (`jane@partnerbrand.com`) or a whole company
 * (`@partnerbrand.com`). User-facing problems come back as `{ ok:false, error }`
 * rather than thrown, because Next redacts thrown server-action messages in
 * production.
 */
export async function addToAllowlist(actor: AdminActor, raw: string) {
  const { result, auditId } = await withAudit(
    actor,
    "allowlist.add",
    { type: "allowlist", id: null },
    { raw },
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
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
        addedBy: actor.userId,
      })

      revalidatePath("/admin/users")
      return { ok: true }
    },
  )
  return { ...result, auditId }
}

export async function removeFromAllowlist(actor: AdminActor, email: string) {
  const normalized = email.trim().toLowerCase()
  const { auditId } = await withAudit(
    actor,
    "allowlist.remove",
    { type: "allowlist", id: normalized },
    { email: normalized },
    async () => {
      await db.delete(allowlist).where(eq(allowlist.email, normalized))
      revalidatePath("/admin/users")
    },
  )
  return { auditId }
}
