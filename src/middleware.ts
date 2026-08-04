import { NextResponse, type NextRequest } from "next/server"
import { isPublicPath } from "@/lib/auth-public-paths"

/**
 * Deny-by-default edge gate: anything outside PUBLIC_PATHS needs a session
 * cookie, so a page or route added without its own guard is not reachable
 * anonymously.
 *
 * This checks that a session cookie is PRESENT, not that it is valid — and
 * that is deliberate. `src/auth.ts` registers the Drizzle adapter, so Auth.js
 * runs the `database` session strategy (@auth/core init.js: `strategy:
 * config.adapter ? "database" : "jwt"`) and the cookie holds an opaque session
 * token, not a JWT. Validating it means a DB lookup, which the edge runtime
 * cannot do.
 *
 * A previous version of this file built a second NextAuth instance from
 * authConfig with no adapter. That instance resolved to the `jwt` strategy and
 * tried to JWE-decode the database session token, so EVERY authenticated
 * request threw `JWTSessionError: Invalid Compact JWE` and 307'd to /login —
 * sign-in was impossible. Do not reintroduce a NextAuth instance here without
 * first moving sessions to the `jwt` strategy.
 *
 * Real enforcement therefore lives in the Node runtime, where the session can
 * actually be verified: every protected surface calls `auth()` (admin/seller
 * via layout.tsx, /account/* and /browse per page, the API routes) or a helper
 * from src/lib/auth-guards.ts. Server actions are not covered by middleware at
 * all and always need their own guard. This gate keeps unauthenticated traffic
 * out early and cheaply; it is not the last line of defence.
 */

// Auth.js names the session cookie by environment: the "__Secure-" prefix is
// added when secure cookies are on (https), so production and local dev differ.
// Both are listed rather than derived, since NODE_ENV is "production" on
// preview deployments too. An oversized cookie is split into ".0"/".1"/… chunks,
// in which case the unsuffixed name is absent — hence the chunk check.
const SESSION_COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"]

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some(
    (name) => request.cookies.has(name) || request.cookies.has(`${name}.0`),
  )
}

export function middleware(request: NextRequest): NextResponse {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next()
  if (hasSessionCookie(request)) return NextResponse.next()

  // Mirrors what the NextAuth middleware used to emit, so the URL shape stays
  // familiar in logs. The login page starts its own flow with
  // `signIn("google", { redirectTo: "/browse" })` and does not read this param.
  const loginUrl = new URL("/login", request.nextUrl.origin)
  loginUrl.searchParams.set("callbackUrl", request.url)
  return NextResponse.redirect(loginUrl, 307)
}

export const config = {
  matcher: [
    /*
     * Run on all request paths except:
     * - api/auth        Auth.js endpoints (must never be intercepted)
     * - _next/static    static files
     * - _next/image     image optimization
     * - favicon.ico     favicon
     * - preview         preview routes (dev only)
     * - static assets   anything with a file extension (images, fonts, etc.)
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|preview|.*\\.[^/]+$).*)",
  ],
}
