import { describe, it, expect } from "vitest"
import { authConfig } from "@/auth.config"

/**
 * Table test for the REAL middleware `authorized` callback in src/auth.config.ts
 * (PUBLIC_PATHS + full-gate). Pure function — no mocks needed.
 */

type AuthorizedCallback = (params: {
  request: { nextUrl: { pathname: string } }
  auth: { user: { id: string } } | null
}) => boolean

const authorized = authConfig.callbacks!.authorized as unknown as AuthorizedCallback

function isAllowed(pathname: string, authed: boolean): boolean {
  return authorized({
    request: { nextUrl: { pathname } },
    auth: authed ? { user: { id: "u1" } } : null,
  })
}

// The middleware file used to sit at the repo root while the app lives in src/,
// so Next never loaded it and this callback never ran in production. Now that it
// does run, "/" must be public — src/app/page.tsx is the logged-out marketing
// landing (it redirects authed visitors to /browse), so gating it would make the
// landing page unreachable for anonymous visitors.
describe("authorized callback: the marketing landing is public but does not open everything", () => {
  it("allows / without a session", () => {
    expect(isAllowed("/", false)).toBe(true)
  })

  it("still allows / with a session (page.tsx redirects to /browse itself)", () => {
    expect(isAllowed("/", true)).toBe(true)
  })

  // Guard against the obvious footgun: "/" must match the root EXACTLY and must
  // not prefix-match every route into being public.
  it.each([
    "/browse",
    "/admin",
    "/admin/users",
    "/account/favorites",
    "/seller/listings",
    "/listings/abc-123",
    "/api/listings",
  ])("%s still requires a session", (path) => {
    expect(isAllowed(path, false)).toBe(false)
  })
})

describe("authorized callback: public paths need no session", () => {
  const publicPaths = [
    "/",
    "/login",
    "/access-denied",
    "/action-complete",
    "/api/auth",
    "/api/auth/callback/google",
    "/api/auth/signin",
    "/api/actions/some-jwt-token",
    "/api/cron/reminders",
    "/api/cron/competitor-alerts",
    "/api/cron/sync-owner-directory",
    "/action-complete/success",
  ]

  it.each(publicPaths)("%s is reachable without a session", (path) => {
    expect(isAllowed(path, false)).toBe(true)
  })

  it.each(publicPaths)("%s is also reachable with a session", (path) => {
    expect(isAllowed(path, true)).toBe(true)
  })
})

describe("authorized callback: everything else requires a session", () => {
  // "/" was previously listed here, asserting the root was gated. That
  // expectation was never exercised — the middleware file sat at the repo root
  // while the app lives in src/, so Next never loaded it and this callback never
  // ran in production. Enforcing it would make the logged-out marketing landing
  // (src/app/page.tsx) unreachable by anyone: anonymous visitors would be sent
  // to /login, and authed visitors are redirected to /browse by the page itself.
  // "/" is therefore public, and is covered by its own describe block above.
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

  it.each(privatePaths)("%s is rejected without a session", (path) => {
    expect(isAllowed(path, false)).toBe(false)
  })

  it.each(privatePaths)("%s is allowed with a session", (path) => {
    expect(isAllowed(path, true)).toBe(true)
  })
})

describe("authorized callback: prefix matching does not over-match", () => {
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
    expect(isAllowed(path, false)).toBe(false)
  })
})
