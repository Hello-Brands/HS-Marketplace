/**
 * Canonical URLs for the MCP OAuth authorization server.
 *
 * This module is deliberately NOT a `"use server"` file — every export of such
 * a module is reachable as an unauthenticated POST endpoint. It is a plain
 * helper imported by routes, the consent page and PR C's MCP endpoint.
 *
 * Every OAuth string in this feature hangs off `issuerUrl()`: the metadata
 * documents, the `iss` parameter on the authorization redirect (RFC 9207), the
 * RFC 8707 `resource` indicator, and the `WWW-Authenticate` challenge. Keep one
 * source so a mismatch is impossible — clients reject a `resource` that differs
 * from the one they were issued against by a single character.
 */
import { env } from "@/lib/env"

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "")
}

/** `MCP_ISSUER_URL` when set, else the app's canonical URL. No trailing slash. */
export function issuerUrl(): string {
  const raw = env.MCP_ISSUER_URL || env.NEXT_PUBLIC_APP_URL
  if (!raw) {
    // Throw rather than emit "undefined/api/mcp", which clients would cache.
    throw new Error(
      "MCP issuer URL is not configured: set MCP_ISSUER_URL or NEXT_PUBLIC_APP_URL",
    )
  }
  return stripTrailingSlash(raw)
}

/** RFC 8707 resource indicator — the exact MCP endpoint URL. */
export function mcpResourceUrl(): string {
  return `${issuerUrl()}/api/mcp`
}

/**
 * RFC 9728 protected-resource metadata URL, path-suffixed with the resource's
 * own path. Claude probes this variant first.
 */
export function protectedResourceMetadataUrl(): string {
  return `${issuerUrl()}/.well-known/oauth-protected-resource/api/mcp`
}
