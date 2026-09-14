/**
 * Who is performing an admin mutation, and through which surface.
 *
 * This module is deliberately NOT a `"use server"` file — see
 * src/lib/alerts/matching.ts for why. Server actions build an actor from the
 * session; the MCP server builds one from a verified bearer token.
 */
export type AdminActorSource = "ui" | "mcp"

export interface AdminActor {
  userId: string
  source: AdminActorSource
  /** MCP only: the OAuth client that made the call. */
  clientId?: string
  /** MCP only: the grant (token row) that made the call. */
  tokenId?: string
}

export function uiActor(userId: string): AdminActor {
  return { userId, source: "ui" }
}

/** Build a UI actor from an Auth.js session user; the id is optional in the type. */
export function uiActorFromSession(user: { id?: string | null }): AdminActor {
  if (!user.id) throw new Error("Unauthorized")
  return uiActor(user.id)
}
