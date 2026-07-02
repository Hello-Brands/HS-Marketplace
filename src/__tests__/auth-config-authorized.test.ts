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

describe("authorized callback: public paths need no session", () => {
  const publicPaths = [
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
  const privatePaths = [
    "/",
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
