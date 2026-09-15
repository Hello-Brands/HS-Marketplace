"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth-guards"
import { uiActorFromSession } from "@/lib/admin/core/actor"
import { revokeMcpToken } from "@/lib/mcp/oauth/grants"

/**
 * Revoke one MCP connection from the admin UI.
 *
 * Thin by design: this is a `"use server"` export, i.e. a public POST endpoint,
 * so its only jobs are to resolve the session (never trust a caller-supplied
 * user id) and to hand the work to the plain module in
 * src/lib/mcp/oauth/grants.ts.
 *
 * It does NOT wrap the call in `withAudit` — `revokeMcpToken` already audits
 * itself and returns the `auditId`, so wrapping here would write two
 * `mcp_token.revoke` rows into the activity feed for one revocation.
 *
 * `ownOnly: false` — an admin may revoke ANY admin's connection from this page
 * (spec section 4.4's "All admins" toggle). PR C's `revoke_mcp_connection` tool
 * passes true instead, so a bearer token can never cut off a different admin.
 */
export async function revokeMcpConnection(
  tokenId: string,
): Promise<{ ok: true; auditId: string } | { ok: false; error: string; auditId: string }> {
  const admin = await requireAdmin()

  const result = await revokeMcpToken(uiActorFromSession(admin), {
    tokenId,
    ownOnly: false,
  })

  revalidatePath("/admin/mcp-connections")
  return result
}
