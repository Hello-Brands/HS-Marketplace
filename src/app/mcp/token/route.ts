import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { mcpOauthClients, mcpOauthCodes, mcpOauthTokens } from "@/db/schema/mcpOauth"
import { checkRateLimit } from "@/lib/rate-limit"
import { generateOpaqueToken, sha256Hex, verifyPkceS256 } from "@/lib/mcp/oauth/tokens"
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  TOKEN_ENDPOINT_RATE_LIMIT,
  TOKEN_ENDPOINT_RATE_WINDOW_MS,
} from "@/lib/mcp/oauth/constants"

/**
 * OAuth 2.1 token endpoint (spec section 4.2).
 *
 * Two grants: `authorization_code` (with mandatory PKCE S256) and
 * `refresh_token` (rotating both hashes and re-checking that the account is
 * still an admin). Errors follow RFC 6749 section 5.2 and every response —
 * success or failure — carries `Cache-Control: no-store`.
 *
 * Never log `code`, `code_verifier`, `refresh_token` or any issued token.
 */
export const runtime = "nodejs"

const JSON_NO_STORE: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
}

function oauthError(error: string, description: string, status = 400): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: JSON_NO_STORE,
  })
}

function tokenResponse(accessToken: string, refreshToken: string, scope: string): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope,
    }),
    { status: 200, headers: JSON_NO_STORE },
  )
}

/**
 * First hop of x-forwarded-for — the client. Later hops are our own proxies, so
 * keying on the whole header would let one client rotate its budget by changing
 * the chain.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  return request.headers.get("x-real-ip") ?? "unknown"
}

export async function POST(request: Request): Promise<Response> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase()
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return oauthError(
      "invalid_request",
      "The token endpoint accepts application/x-www-form-urlencoded only.",
      415,
    )
  }

  // Best-effort only: src/lib/rate-limit.ts is per-instance in-memory
  // (DEBT-028). It throttles one hot-looping caller on a warm instance; it is
  // not a distributed guarantee.
  const limit = checkRateLimit(
    `mcp-token:${clientIp(request)}`,
    TOKEN_ENDPOINT_RATE_LIMIT,
    TOKEN_ENDPOINT_RATE_WINDOW_MS,
  )
  if (!limit.allowed) {
    // RFC 6749 section 5.2 defines no code for throttling, so this reuses
    // invalid_request and carries the detail in Retry-After.
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        error_description: "Too many token requests. Try again shortly.",
      }),
      {
        status: 429,
        headers: {
          ...JSON_NO_STORE,
          "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 0) / 1000)),
        },
      },
    )
  }

  const form = new URLSearchParams(await request.text())

  const clientId = form.get("client_id")
  if (!clientId) return oauthError("invalid_client", "client_id is required.")

  const client = await db.query.mcpOauthClients.findFirst({
    where: eq(mcpOauthClients.clientId, clientId),
  })
  if (!client) return oauthError("invalid_client", "Unknown client_id.")

  const grantType = form.get("grant_type")
  if (grantType === "authorization_code") return exchangeAuthorizationCode(form, clientId)
  if (grantType === "refresh_token") return exchangeRefreshToken(form, clientId)

  return oauthError(
    "unsupported_grant_type",
    "Supported grant types are authorization_code and refresh_token.",
  )
}

async function exchangeAuthorizationCode(
  form: URLSearchParams,
  clientId: string,
): Promise<Response> {
  const code = form.get("code")
  const redirectUri = form.get("redirect_uri")
  const codeVerifier = form.get("code_verifier")
  if (!code || !redirectUri || !codeVerifier) {
    return oauthError("invalid_request", "code, redirect_uri and code_verifier are required.")
  }

  const row = await db.query.mcpOauthCodes.findFirst({
    where: eq(mcpOauthCodes.codeHash, sha256Hex(code)),
  })
  const now = new Date()

  // One generic message per branch: an attacker learns nothing from which of
  // these fired, and the presented values are never echoed.
  if (!row) return oauthError("invalid_grant", "Authorization code is invalid.")
  if (row.usedAt) {
    return oauthError("invalid_grant", "Authorization code has already been used.")
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    return oauthError("invalid_grant", "Authorization code has expired.")
  }
  if (row.clientId !== clientId) {
    return oauthError("invalid_grant", "Authorization code was issued to another client.")
  }
  if (row.redirectUri !== redirectUri) {
    return oauthError("invalid_grant", "redirect_uri does not match the authorization request.")
  }
  // `resource` is optional at this endpoint: the stored value was already
  // validated against mcpResourceUrl() when the code was minted at
  // /mcp/authorize. When a client does send it, it must name the same resource.
  const resource = form.get("resource")
  if (resource !== null && resource !== row.resource) {
    return oauthError("invalid_grant", "resource does not match the authorization request.")
  }
  if (!verifyPkceS256(codeVerifier, row.codeChallenge)) {
    return oauthError("invalid_grant", "PKCE verification failed.")
  }

  const accessToken = generateOpaqueToken()
  const refreshToken = generateOpaqueToken()

  // neon-http has no db.transaction (spec section 3). db.batch is the atomic
  // unit: without it a crash between the two writes leaves a replayable code.
  await db.batch([
    db.update(mcpOauthCodes).set({ usedAt: now }).where(eq(mcpOauthCodes.codeHash, row.codeHash)),
    db.insert(mcpOauthTokens).values({
      tokenHash: sha256Hex(accessToken),
      refreshTokenHash: sha256Hex(refreshToken),
      clientId: row.clientId,
      userId: row.userId,
      scope: row.scope,
      label: row.label,
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    }),
  ])

  return tokenResponse(accessToken, refreshToken, row.scope)
}

async function exchangeRefreshToken(form: URLSearchParams, clientId: string): Promise<Response> {
  const refreshToken = form.get("refresh_token")
  if (!refreshToken) return oauthError("invalid_request", "refresh_token is required.")

  const row = await db.query.mcpOauthTokens.findFirst({
    where: eq(mcpOauthTokens.refreshTokenHash, sha256Hex(refreshToken)),
  })
  const now = new Date()

  if (!row) return oauthError("invalid_grant", "Refresh token is invalid.")
  if (row.revokedAt) return oauthError("invalid_grant", "This connection has been revoked.")
  if (row.refreshExpiresAt.getTime() <= now.getTime()) {
    return oauthError("invalid_grant", "Refresh token has expired.")
  }
  if (row.clientId !== clientId) {
    return oauthError("invalid_grant", "Refresh token was issued to another client.")
  }

  // Live admin re-check: a demoted account loses the connection at its next
  // refresh, not thirty days later.
  const user = await db.query.users.findFirst({
    where: eq(users.id, row.userId),
    columns: { role: true },
  })
  if (user?.role !== "admin") {
    return oauthError("invalid_grant", "The connected account is no longer a marketplace admin.")
  }

  const accessToken = generateOpaqueToken()
  const nextRefreshToken = generateOpaqueToken()

  // Rotation in place: the previous access AND refresh tokens are dead the
  // moment this row updates. One row per grant, never two.
  await db
    .update(mcpOauthTokens)
    .set({
      tokenHash: sha256Hex(accessToken),
      refreshTokenHash: sha256Hex(nextRefreshToken),
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    })
    .where(eq(mcpOauthTokens.id, row.id))

  return tokenResponse(accessToken, nextRefreshToken, row.scope)
}
