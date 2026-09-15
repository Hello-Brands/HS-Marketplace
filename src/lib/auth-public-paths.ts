/**
 * Paths reachable without a session, shared by the edge gate in
 * src/middleware.ts and its tests.
 *
 * These either ARE the auth flow, or they authenticate by a secret/token
 * instead of the session cookie (Vercel cron jobs via CRON_SECRET, no-login
 * email action links via ACTION_TOKEN_SECRET). Gating them would break
 * sign-in, the cron emails, and the action links.
 *
 * Deliberately dependency-free: this module is imported by middleware, which
 * runs on the edge runtime and must stay clear of DB, next-auth and any
 * `server-only` module.
 */
export const PUBLIC_PATHS = [
  "/", // logged-out marketing landing (src/app/page.tsx sends authed users to /browse)
  "/login",
  "/check-email", // Auth.js verifyRequest landing page, reached with no session
  "/access-denied",
  "/action-complete", // no-login email action landing page
  "/api/auth", // Auth.js sign-in/callback endpoints
  "/api/actions", // token-authed email action links
  "/api/cron", // CRON_SECRET-authed Vercel cron jobs
  // MCP OAuth 2.1 authorization server (spec section 4.2). Each of these
  // authenticates itself rather than by session cookie:
  //   /.well-known/*   public discovery documents, no auth at all
  //   /mcp/authorize   renders its own login redirect and admin check, so the
  //                    callbackUrl points back at the consent screen instead
  //                    of the gate's default landing
  //   /mcp/token       authenticated by the PKCE code or the refresh token
  //   /mcp/revoke      authenticated by the token being revoked
  //   /api/mcp         the MCP endpoint itself, authenticated by the OAuth
  //                    access token in its Authorization header. Gating it
  //                    turned every bearer request into a 307 to /login, so
  //                    the handler's 401 + WWW-Authenticate never reached the
  //                    client and no MCP client could discover the
  //                    authorization server or connect at all.
  "/.well-known",
  "/mcp/authorize",
  "/mcp/token",
  "/mcp/revoke",
  "/api/mcp",
] as const

/**
 * Match a public prefix exactly, or at a "/" boundary — never as a bare string
 * prefix, so "/login-fake" and "/api/authx" stay gated.
 *
 * Note on "/": the test below is `pathname === p || startsWith(p + "/")`, so
 * "/" would only ever prefix-match "//…". It matches the root exactly and does
 * NOT make every route public.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
