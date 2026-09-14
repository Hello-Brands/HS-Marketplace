"use server"

import { requireAdmin } from "@/lib/auth-guards"
import { uiActorFromSession } from "@/lib/admin/core/actor"
import { setLocationMapping as setLocationMappingCore, type LocationMappingInput } from "@/lib/admin/core/data-mappings"

/**
 * Admin data-mapping server action. Public POST endpoint → begins with
 * `requireAdmin()` (throws), matching every other admin action. Logic lives in
 * src/lib/admin/core/data-mappings.ts so the MCP server can share it.
 */
export async function setLocationMapping(locationId: string, input: LocationMappingInput) {
  const admin = await requireAdmin()
  return setLocationMappingCore(uiActorFromSession(admin), locationId, input)
}
