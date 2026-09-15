"use server"

import { redirect } from "next/navigation"
import { db } from "@/db"
import { mcpOauthCodes } from "@/db/schema/mcpOauth"
import { requireAdmin } from "@/lib/auth-guards"
import { issuerUrl } from "@/lib/mcp/oauth/urls"
import { generateOpaqueToken, sha256Hex } from "@/lib/mcp/oauth/tokens"
import { formatScopes, type McpScope } from "@/lib/mcp/oauth/scopes"
import {
  AUTHORIZATION_CODE_TTL_MS,
  CONSENT_LABEL_MAX_LENGTH,
} from "@/lib/mcp/oauth/constants"
import { loadAndValidateAuthorizeRequest } from "@/lib/mcp/oauth/authorize-request"
import {
  buildAuthorizeErrorRedirect,
  buildAuthorizeSuccessRedirect,
} from "@/lib/mcp/oauth/authorize-validation"

/**
 * Mint an authorization code for the consent screen (spec section 4.2 step 5).
 *
 * This is a `"use server"` export, i.e. a PUBLIC POST endpoint whose action id
 * ships in the client bundle. The hidden form fields are therefore NOT a trust
 * boundary: every parameter is re-read from the DB and re-validated here,
 * through the same `loadAndValidateAuthorizeRequest` helper the page used, and
 * the granted scope is intersected with the scope the client actually requested
 * so a tampered radio cannot widen it.
 */
export async function approveMcpConsent(formData: FormData): Promise<void> {
  const admin = await requireAdmin()
  if (!admin.id) throw new Error("Unauthorized: Admin access required")

  const validation = await loadAndValidateAuthorizeRequest(
    Object.fromEntries(formData),
  )

  // An unverified redirect_uri must never receive a redirect — throw instead.
  // Next redacts thrown server-action messages in production, which is the
  // right outcome here: reaching this branch means the form was tampered with.
  if (validation.kind === "error_page") {
    throw new Error(validation.message)
  }

  const issuer = issuerUrl()

  if (validation.kind === "error_redirect") {
    return redirect(
      buildAuthorizeErrorRedirect({
        redirectUri: validation.redirectUri,
        error: validation.error,
        description: validation.description,
        state: validation.state,
        issuer,
      }),
    )
  }

  const request = validation.request

  // Fail closed: anything other than an explicit approval is a denial.
  if (formData.get("decision") !== "approve") {
    return redirect(
      buildAuthorizeErrorRedirect({
        redirectUri: request.redirectUri,
        error: "access_denied",
        description: "The administrator denied this request.",
        state: request.state,
        issuer,
      }),
    )
  }

  // Granted scope is the intersection of the radio choice with what the client
  // requested — never wider than either.
  const wantsWrite = formData.get("scope_choice") === "read_write"
  const granted: McpScope[] = request.requestedScopes.filter(
    (scope) =>
      scope === "marketplace:read" || (wantsWrite && scope === "marketplace:write"),
  )
  if (granted.length === 0) {
    return redirect(
      buildAuthorizeErrorRedirect({
        redirectUri: request.redirectUri,
        error: "invalid_scope",
        description: "No supported scope was granted.",
        state: request.state,
        issuer,
      }),
    )
  }

  const rawLabel = formData.get("label")
  const label =
    typeof rawLabel === "string"
      ? rawLabel.trim().slice(0, CONSENT_LABEL_MAX_LENGTH) || null
      : null

  const code = generateOpaqueToken()

  // Only the hash is stored: a database read must never yield a usable code.
  await db.insert(mcpOauthCodes).values({
    codeHash: sha256Hex(code),
    clientId: request.client.clientId,
    userId: admin.id,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scope: formatScopes(granted),
    resource: request.resource,
    label,
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
  })

  return redirect(
    buildAuthorizeSuccessRedirect({
      redirectUri: request.redirectUri,
      code,
      state: request.state,
      issuer,
    }),
  )
}
