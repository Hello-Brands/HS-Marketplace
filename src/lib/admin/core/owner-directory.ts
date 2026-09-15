// src/lib/admin/core/owner-directory.ts
/**
 * Owner-directory sync trigger — shared by src/lib/owner-directory/actions.ts
 * and the MCP write tools.
 *
 * This module is deliberately NOT a `"use server"` file. Takes a trusted
 * `AdminActor`; does NOT check auth. Do not re-export from a `"use server"`
 * module and do not add `"use server"` here.
 */
import { revalidatePath } from "next/cache"
import { syncOwnerLocations, type SyncResult } from "@/lib/owner-directory/sync"
import { withAudit } from "@/lib/admin/audit"
import type { AdminActor } from "./actor"

export async function refreshOwnerDirectory(actor: AdminActor) {
  const { result, auditId } = await withAudit(
    actor,
    "owner_directory.refresh",
    { type: "owner_directory", id: null },
    {},
    async (): Promise<{ ok: true; result: SyncResult } | { ok: false; error: string }> => {
      try {
        const result = await syncOwnerLocations()
        revalidatePath("/admin/owner-directory")
        return { ok: true, result }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "sync failed" }
      }
    },
  )
  return { ...result, auditId }
}
