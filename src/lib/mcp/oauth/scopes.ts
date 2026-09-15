/**
 * The MCP scope vocabulary.
 *
 * NOT a `"use server"` module — every export of such a module is a public POST
 * endpoint. This is a plain constants/parsing module, imported by the consent
 * page, the metadata routes, the token endpoint and PR C's tool registry.
 *
 * Kept free of any `@/db` or `@/lib/env` import so it stays usable from pure
 * unit tests and from `tsx` scripts.
 */
export const MCP_SCOPES = ["marketplace:read", "marketplace:write"] as const

export type McpScope = (typeof MCP_SCOPES)[number]

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value)
}

/**
 * Parse a space-separated OAuth scope string.
 *
 * Returns the de-duplicated list, or `null` when ANY entry is unsupported —
 * the caller turns null into `error=invalid_scope`. An absent or whitespace-only
 * value means "everything supported": the consent screen is what narrows the
 * grant, so an omitted `scope` must not silently mint a zero-scope token.
 */
export function parseScopeString(raw: string | null | undefined): McpScope[] | null {
  const parts = (raw ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return [...MCP_SCOPES]
  if (!parts.every(isMcpScope)) return null
  return [...new Set(parts as McpScope[])]
}

/** Render a scope list back into the wire format. */
export function formatScopes(scopes: readonly McpScope[]): string {
  return scopes.join(" ")
}
