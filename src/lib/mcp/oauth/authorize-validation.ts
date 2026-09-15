/**
 * Validation for `GET /mcp/authorize` (spec section 4.2).
 *
 * NOT a `"use server"` module and deliberately DB-free: the caller looks the
 * client up and passes the row in, which is what lets every branch below be
 * unit-tested under this repo's node-env vitest.
 *
 * THE ORDER IS THE SECURITY PROPERTY. Until `client_id` AND `redirect_uri` are
 * known-good we must render an error page: redirecting an error to an
 * unverified URI is an open redirect that also leaks `state`. Only after both
 * check out may a failure be reported by redirect.
 */
import { redirectUriMatches } from "./tokens"
import { parseScopeString, type McpScope } from "./scopes"

export interface McpOauthClientRecord {
  clientId: string
  name: string
  redirectUris: string[]
}

export interface AuthorizeParams {
  clientId: string | null
  redirectUri: string | null
  responseType: string | null
  codeChallenge: string | null
  codeChallengeMethod: string | null
  scope: string | null
  state: string | null
  resource: string | null
}

export interface ValidAuthorizeRequest {
  client: McpOauthClientRecord
  /** The URI as PRESENTED -- the token exchange compares against this exact string. */
  redirectUri: string
  codeChallenge: string
  requestedScopes: McpScope[]
  state: string | null
  resource: string
}

export type AuthorizeValidation =
  | { kind: "error_page"; message: string }
  | {
      kind: "error_redirect"
      redirectUri: string
      error: string
      description: string
      state: string | null
    }
  | { kind: "ok"; request: ValidAuthorizeRequest }

export function validateAuthorizeParams(
  params: AuthorizeParams,
  client: McpOauthClientRecord | null,
  expectedResource: string,
): AuthorizeValidation {
  // --- Phase 1: nothing may redirect yet. ---
  if (!params.clientId) {
    return { kind: "error_page", message: "Missing client_id." }
  }
  if (!client) {
    return { kind: "error_page", message: `Unknown client_id: ${params.clientId}` }
  }
  if (!params.redirectUri) {
    return { kind: "error_page", message: "Missing redirect_uri." }
  }
  if (!redirectUriMatches(client.redirectUris, params.redirectUri)) {
    return {
      kind: "error_page",
      message: "redirect_uri is not registered for this client.",
    }
  }

  // --- Phase 2: redirect_uri is verified, so errors may go back to the client. ---
  const redirectUri = params.redirectUri
  const state = params.state
  const fail = (error: string, description: string): AuthorizeValidation => ({
    kind: "error_redirect",
    redirectUri,
    error,
    description,
    state,
  })

  if (params.responseType !== "code") {
    return fail(
      "unsupported_response_type",
      "Only response_type=code is supported.",
    )
  }
  if (!params.codeChallenge) {
    return fail("invalid_request", "code_challenge is required (PKCE is mandatory).")
  }
  if (params.codeChallengeMethod !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256.")
  }
  if (params.resource !== expectedResource) {
    // RFC 8707 resource indicator. Spec section 4.2 constrains error codes to
    // the RFC 6749 set, so this is invalid_request rather than invalid_target.
    return fail("invalid_request", `resource must be ${expectedResource}.`)
  }

  const requestedScopes = parseScopeString(params.scope)
  if (!requestedScopes) {
    return fail(
      "invalid_scope",
      "Supported scopes are marketplace:read and marketplace:write.",
    )
  }

  return {
    kind: "ok",
    request: {
      client,
      redirectUri,
      codeChallenge: params.codeChallenge,
      requestedScopes,
      state,
      resource: expectedResource,
    },
  }
}

function withParams(
  redirectUri: string,
  entries: Array<[string, string | null]>,
): string {
  const url = new URL(redirectUri)
  for (const [key, value] of entries) {
    if (value !== null) url.searchParams.set(key, value)
  }
  return url.toString()
}

/** RFC 6749 4.1.2.1 error redirect, plus the RFC 9207 `iss` parameter. */
export function buildAuthorizeErrorRedirect(opts: {
  redirectUri: string
  error: string
  description: string
  state: string | null
  issuer: string
}): string {
  return withParams(opts.redirectUri, [
    ["error", opts.error],
    ["error_description", opts.description],
    ["state", opts.state],
    ["iss", opts.issuer],
  ])
}

/** RFC 6749 4.1.2 success redirect, plus the RFC 9207 `iss` parameter. */
export function buildAuthorizeSuccessRedirect(opts: {
  redirectUri: string
  code: string
  state: string | null
  issuer: string
}): string {
  return withParams(opts.redirectUri, [
    ["code", opts.code],
    ["state", opts.state],
    ["iss", opts.issuer],
  ])
}
