import { describe, it, expect } from "vitest"
import { NextRequest } from "next/server"
import { middleware } from "@/middleware"
import { isPublicPath } from "@/lib/auth-public-paths"

/**
 * Tests for the edge session gate in src/middleware.ts.
 *
 * Replaces auth-config-authorized.test.ts, which tested the `authorized`
 * callback in auth.config.ts. That callback ran inside a NextAuth instance
 * built WITHOUT the Drizzle adapter, so it resolved to the `jwt` session
 * strategy and tried to JWE-decode a session cookie that is actually an opaque
 * database session token. In production that threw JWTSessionError on every
 * authenticated request and 307'd valid sessions to /login — sign-in was
 * completely broken. The gate is now a cookie-PRESENCE check (no decoding,
 * which is impossible at the edge with database sessions); validity is still
 * enforced by auth() in layouts, pages, API routes and server actions.
 */

const PROD_COOKIE = "__Secure-authjs.session-token"
const DEV_COOKIE = "authjs.session-token"

function request(pathname: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(new URL(`https://marketplace.hellosugar.salon${pathname}`))
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value)
  }
  return req
}

/** The gate's decision: true = request proceeds, false = redirected to /login. */
function allowed(pathname: string, cookies: Record<string, string> = {}): boolean {
  const res = middleware(request(pathname, cookies))
  // NextResponse.next() carries no Location; a redirect does.
  return !res.headers.get("location")
}

// The exact production failure: Google sign-in succeeded, the callback set a
// valid database session cookie, and the very next request to /browse was
// still bounced to /login. This is the regression test for that.
describe("a request carrying a session cookie reaches the protected route", () => {
  it.each([
    ["production cookie name", PROD_COOKIE],
    ["development cookie name", DEV_COOKIE],
  ])("allows /browse with the %s", (_label, name) => {
    // An opaque database session token — NOT a JWE. Decoding this is what broke.
    expect(allowed("/browse", { [name]: "8f14e45f-ceea-467a-9c2b-8b1c9dd0e2f1" })).toBe(true)
  })

  it.each([
    "/browse",
    "/admin",
    "/admin/users",
    "/account/favorites",
    "/seller/listings",
    "/listings/abc-123",
    "/api/listings",
  ])("allows %s with a session cookie", (path) => {
    expect(allowed(path, { [PROD_COOKIE]: "opaque-session-token" })).toBe(true)
  })

  // Auth.js splits an oversized session cookie into .0/.1/… chunks, in which
  // case the unsuffixed name is absent entirely.
  it("allows a chunked session cookie", () => {
    expect(allowed("/browse", { [`${PROD_COOKIE}.0`]: "chunk-zero" })).toBe(true)
  })
})

describe("a request with no session cookie is sent to /login", () => {
  const privatePaths = [
    "/browse",
    "/browse/some-listing",
    "/admin",
    "/admin/users",
    "/account",
    "/sell",
    "/api/upload",
    "/api/listings/draft",
  ]

  it.each(privatePaths)("%s is rejected without a session cookie", (path) => {
    expect(allowed(path)).toBe(false)
  })

  it("redirects to /login and preserves where the user was going", () => {
    const res = middleware(request("/browse"))
    const location = new URL(res.headers.get("location")!)
    expect(location.pathname).toBe("/login")
    expect(location.searchParams.get("callbackUrl")).toBe(
      "https://marketplace.hellosugar.salon/browse",
    )
  })

  // Anonymous visitors already hold authjs.csrf-token and authjs.callback-url,
  // so a gate that accepts "any authjs cookie" would fail OPEN for everyone.
  it.each([
    ["a CSRF token", { "authjs.csrf-token": "abc" }],
    ["a callback-url cookie", { "authjs.callback-url": "https://x/browse" }],
    ["an unrelated cookie", { theme: "dark" }],
    ["a lookalike name", { "authjs.session-token-x": "nope" }],
  ])("rejects /browse with only %s", (_label, cookies) => {
    expect(allowed("/browse", cookies)).toBe(false)
  })
})

// src/app/page.tsx is the logged-out marketing landing and redirects authed
// visitors to /browse itself, so gating "/" would make it unreachable by
// ANYONE: anonymous -> /login, authed -> /browse.
describe("the marketing landing is public but does not open everything", () => {
  it("allows / without a session", () => {
    expect(allowed("/")).toBe(true)
  })

  it("still allows / with a session", () => {
    expect(allowed("/", { [PROD_COOKIE]: "opaque-session-token" })).toBe(true)
  })
})

describe("public paths need no session", () => {
  const publicPaths = [
    "/",
    "/login",
    "/access-denied",
    "/action-complete",
    "/action-complete/success",
    "/api/auth",
    "/api/auth/callback/google",
    "/api/auth/signin",
    "/api/actions/some-jwt-token",
    "/api/cron/reminders",
    "/api/cron/competitor-alerts",
    "/api/cron/sync-owner-directory",
  ]

  it.each(publicPaths)("%s is reachable without a session", (path) => {
    expect(allowed(path)).toBe(true)
  })

  it.each(publicPaths)("%s is also reachable with a session", (path) => {
    expect(allowed(path, { [PROD_COOKIE]: "opaque-session-token" })).toBe(true)
  })
})

describe("prefix matching does not over-match", () => {
  // A public prefix must only match exactly or at a "/" boundary — lookalike
  // sibling paths must stay gated.
  const lookalikes = [
    "/loginX",
    "/login-fake",
    "/access-denied-2",
    "/api/authx",
    "/api/auth2/callback",
    "/api/actionsx",
    "/api/cronx",
    "/action-completex",
  ]

  it.each(lookalikes)("%s is NOT treated as public", (path) => {
    expect(isPublicPath(path)).toBe(false)
    expect(allowed(path)).toBe(false)
  })
})
