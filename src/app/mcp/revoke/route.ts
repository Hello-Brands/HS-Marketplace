import { and, eq, isNull, or } from "drizzle-orm"
import { db } from "@/db"
import { mcpOauthTokens } from "@/db/schema/mcpOauth"
import { sha256Hex } from "@/lib/mcp/oauth/tokens"

/**
 * RFC 7009 token revocation (spec section 4.2).
 *
 * `token` may be either half of the pair — one hash is compared against both
 * columns, so a client that revokes whichever token it happens to hold kills
 * the whole grant.
 *
 * Deliberately incurious: an unknown token still returns 200 (RFC 7009 section
 * 2.2). Reporting "no such token" would turn this into an oracle for guessing
 * valid tokens. The presented value is never echoed and never logged.
 */
export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase()
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        error_description:
          "The revocation endpoint accepts application/x-www-form-urlencoded only.",
      }),
      {
        status: 415,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      },
    )
  }

  const form = new URLSearchParams(await request.text())
  const token = form.get("token")
  // RFC 7009 section 2.1: `token` is REQUIRED, so its absence is a malformed
  // request rather than a revocation of nothing.
  if (!token) {
    return new Response(
      JSON.stringify({ error: "invalid_request", error_description: "token is required." }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      },
    )
  }

  const hash = sha256Hex(token)

  // `token_type_hint` is accepted and ignored: matching both columns is cheaper
  // than trusting a hint, and RFC 7009 section 2.1 requires the server to fall
  // back to the other type anyway.
  await db
    .update(mcpOauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        or(eq(mcpOauthTokens.tokenHash, hash), eq(mcpOauthTokens.refreshTokenHash, hash)),
        // Never move an existing revocation timestamp forward.
        isNull(mcpOauthTokens.revokedAt),
      ),
    )

  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } })
}
