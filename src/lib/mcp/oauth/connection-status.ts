/**
 * Display status for one MCP connection.
 *
 * NOT a `"use server"` module, and DB-free — it lives here rather than inside
 * the table component because this repo's vitest cannot import React
 * components (node env, `.ts`-only glob), so logic in a `.tsx` file is untested
 * logic.
 */
export type McpConnectionStatus = "active" | "idle" | "expired" | "revoked"

export const MCP_CONNECTION_STATUS_LABELS: Record<McpConnectionStatus, string> = {
  active: "Active",
  idle: "Idle",
  expired: "Expired",
  revoked: "Revoked",
}

export function mcpConnectionStatus(
  row: { expiresAt: Date; refreshExpiresAt: Date; revokedAt: Date | null },
  now: Date = new Date(),
): McpConnectionStatus {
  // Revocation wins over every clock: it is the state an admin acted to create.
  if (row.revokedAt) return "revoked"
  const t = now.getTime()
  if (row.refreshExpiresAt.getTime() <= t) return "expired"
  // Access token lapsed but the refresh token has not — the client renews on
  // its next call, so this is idle, not broken.
  if (row.expiresAt.getTime() <= t) return "idle"
  return "active"
}
