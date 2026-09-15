/**
 * RFC 8414 (authorization server) and RFC 9728 (protected resource) discovery
 * documents.
 *
 * NOT a `"use server"` module. Shared by the three `.well-known` routes so the
 * two protected-resource URLs cannot drift apart.
 *
 * Deliberately absent: `registration_endpoint` and
 * `client_id_metadata_document_supported`. v1 has no Dynamic Client
 * Registration and no CIMD (spec section 1 non-goals); advertising either would
 * make clients attempt a flow that does not exist. The shape leaves room to add
 * CIMD later without invalidating existing connections.
 */
import { issuerUrl, mcpResourceUrl } from "./urls"
import { MCP_SCOPES } from "./scopes"

export function authorizationServerMetadata(): Record<string, unknown> {
  const issuer = issuerUrl()
  return {
    issuer,
    authorization_endpoint: `${issuer}/mcp/authorize`,
    token_endpoint: `${issuer}/mcp/token`,
    revocation_endpoint: `${issuer}/mcp/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // S256 only. `plain` is neither accepted by /mcp/token nor advertised here.
    code_challenge_methods_supported: ["S256"],
    // Both seeded clients are public: PKCE is the proof, there is no secret.
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SCOPES],
    // RFC 9207: we return `iss` on the authorization redirect, so clients can
    // pin the response to this server.
    authorization_response_iss_parameter_supported: true,
  }
}

export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: mcpResourceUrl(),
    authorization_servers: [issuerUrl()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
  }
}

/**
 * Discovery documents are public and are fetched cross-origin by browser-based
 * clients, so they carry wide-open CORS. They contain no secrets and no
 * user-specific data — only URLs this server already publishes.
 */
export const METADATA_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
}

export function metadataResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Short cache: the documents are static in practice, but a bad issuer
      // value must be fixable inside a deploy cycle rather than an hour later.
      "Cache-Control": "public, max-age=300",
      ...METADATA_CORS_HEADERS,
    },
  })
}

export function metadataPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...METADATA_CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  })
}
