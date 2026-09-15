"use server"

import { requireAdmin } from "@/lib/auth-guards"
import { uiActorFromSession } from "@/lib/admin/core/actor"
import * as usersCore from "@/lib/admin/core/users"
import * as allowlistCore from "@/lib/admin/core/allowlist"

/**
 * Admin user/allowlist server actions. Each export is a public POST endpoint,
 * so every one begins with `requireAdmin()`. Logic lives in
 * src/lib/admin/core/{users,allowlist}.ts so the MCP server can share it.
 */

export async function getUsers() {
  await requireAdmin()
  return usersCore.getUsers()
}

export async function getAllowlist() {
  await requireAdmin()
  return allowlistCore.getAllowlist()
}

export async function setUserRole(userId: string, role: "user" | "admin") {
  const admin = await requireAdmin()
  return usersCore.setUserRole(uiActorFromSession(admin), userId, role)
}

export async function setSellerAccess(userId: string, sellerAccess: boolean) {
  const admin = await requireAdmin()
  return usersCore.setSellerAccess(uiActorFromSession(admin), userId, sellerAccess)
}

export async function addToAllowlist(raw: string) {
  const admin = await requireAdmin()
  return allowlistCore.addToAllowlist(uiActorFromSession(admin), raw)
}

export async function removeFromAllowlist(email: string) {
  const admin = await requireAdmin()
  return allowlistCore.removeFromAllowlist(uiActorFromSession(admin), email)
}

export async function removeUser(userId: string) {
  const admin = await requireAdmin()
  return usersCore.removeUser(uiActorFromSession(admin), userId)
}
