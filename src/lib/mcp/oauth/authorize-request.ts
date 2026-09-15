/**
 * Loads the client row for an authorization request and runs it through
 * `validateAuthorizeParams` (spec §4.2).
 *
 * This module is deliberately NOT a `"use server"` file. Every export of a
 * `"use server"` module is reachable as an unauthenticated POST endpoint (the
 * action ids ship in the client bundle), and this helper reads the client
 * registry — so exposing it as an action would hand anyone a client-existence
 * oracle over the OAuth tables. It is only ever called server-side, from the
 * consent page and from `approveMcpConsent`, so it lives here instead, where it
 * has no action id and cannot be addressed from outside.
 *
 * Keep it that way: do not re-export this from a `"use server"` module, and do
 * not add `"use server"` to this file — either would recreate the endpoint.
 *
 * It exists so the page and the action validate through EXACTLY the same code:
 * the consent form is not a trust boundary (its hidden fields are attacker
 * controlled), so the action has to redo the page's lookup and checks, and two
 * hand-copied versions of that block would drift apart silently.
 */
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { mcpOauthClients } from "@/db/schema/mcpOauth"
import { mcpResourceUrl } from "./urls"
import {
  validateAuthorizeParams,
  type AuthorizeParams,
  type AuthorizeValidation,
} from "./authorize-validation"

/**
 * Either shape the request parameters arrive in: an awaited `searchParams`
 * record on the page, or `Object.fromEntries(formData)` in the action.
 */
export type RawAuthorizeInput = Record<string, unknown>

/** First value only, and only when it is a non-empty string. */
function one(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === "string" && first.length > 0 ? first : null
}

/** Map the wire parameter names onto the validator's input shape. */
export function toAuthorizeParams(raw: RawAuthorizeInput): AuthorizeParams {
  return {
    clientId: one(raw.client_id),
    redirectUri: one(raw.redirect_uri),
    responseType: one(raw.response_type),
    codeChallenge: one(raw.code_challenge),
    codeChallengeMethod: one(raw.code_challenge_method),
    scope: one(raw.scope),
    state: one(raw.state),
    resource: one(raw.resource),
  }
}

/**
 * Look the client up by `client_id` and validate the request against it.
 *
 * Returns the validator's verdict untouched: `error_page` (nothing may be
 * redirected — `client_id`/`redirect_uri` are not yet trustworthy),
 * `error_redirect`, or `ok` with the validated request.
 */
export async function loadAndValidateAuthorizeRequest(
  raw: RawAuthorizeInput,
): Promise<AuthorizeValidation> {
  const params = toAuthorizeParams(raw)

  const client = params.clientId
    ? await db.query.mcpOauthClients.findFirst({
        where: eq(mcpOauthClients.clientId, params.clientId),
      })
    : undefined

  return validateAuthorizeParams(
    params,
    client
      ? {
          clientId: client.clientId,
          name: client.name,
          redirectUris: client.redirectUris,
        }
      : null,
    mcpResourceUrl(),
  )
}
