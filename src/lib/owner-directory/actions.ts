"use server"

import { requireAdmin } from "@/lib/auth-guards"
import { uiActorFromSession } from "@/lib/admin/core/actor"
import * as links from "@/lib/admin/core/owner-links"
import * as directory from "@/lib/admin/core/owner-directory"

/**
 * Owner-directory admin server actions. Each export is a public POST endpoint,
 * so every one begins with `requireAdmin()`. Logic lives in
 * src/lib/admin/core/{owner-links,owner-directory}.ts so the MCP server can
 * share it.
 */

/** Admin-only "refresh now" trigger for the owner directory sync. */
export async function refreshOwnerDirectory() {
  const admin = await requireAdmin()
  return directory.refreshOwnerDirectory(uiActorFromSession(admin))
}

export async function addOwnerLink(userId: string, ownerIdentifier: string) {
  const admin = await requireAdmin()
  return links.addOwnerLink(uiActorFromSession(admin), userId, ownerIdentifier)
}

export async function revokeOwnerLink(userId: string, ownerIdentifier: string) {
  const admin = await requireAdmin()
  return links.revokeOwnerLink(uiActorFromSession(admin), userId, ownerIdentifier)
}

export async function clearOwnerLink(userId: string, ownerIdentifier: string) {
  const admin = await requireAdmin()
  return links.clearOwnerLink(uiActorFromSession(admin), userId, ownerIdentifier)
}
