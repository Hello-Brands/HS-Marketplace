import { auth } from "@/auth"
import type { Session } from "next-auth"

/**
 * Centralized authentication/authorization guards (DEBT-021).
 *
 * These are DEFENSE-IN-DEPTH. The NextAuth middleware (`src/middleware.ts`) is
 * the primary gate that keeps unauthenticated traffic out of the app. These
 * helpers re-check the session at the handler/action level so that if the
 * middleware is ever bypassed or misconfigured, protected routes and mutating
 * server actions degrade to a thrown "Unauthorized" (surfaced as 401/403)
 * instead of leaking or mutating data.
 *
 * That is not hypothetical: the middleware file previously sat at the repo root
 * while the app lives in `src/`, so Next silently never loaded it and these
 * guards were the ONLY thing enforcing auth in production. Server actions are
 * not covered by middleware at all, so every export of a "use server" module
 * still needs its own guard regardless.
 *
 * Each helper calls `auth()` and THROWS on failure — call sites either let the
 * throw propagate (server actions) or wrap it to return a 401 JSON response
 * (API route handlers).
 */

type SessionUser = Session["user"]

/** Requires any authenticated session. Throws when there is none. */
export async function requireSession(): Promise<SessionUser> {
  const session = await auth()
  if (!session?.user) {
    throw new Error("Unauthorized")
  }
  return session.user
}

/** Requires an admin session. Throws otherwise. */
export async function requireAdmin(): Promise<SessionUser> {
  const session = await auth()
  if (!session?.user || session.user.role !== "admin") {
    throw new Error("Unauthorized: Admin access required")
  }
  return session.user
}

/**
 * Requires seller access — either an explicit `sellerAccess` grant or the admin
 * role (admins can manage any seller's listings). Throws otherwise.
 */
export async function requireSellerAccess(): Promise<SessionUser> {
  const session = await auth()
  if (!session?.user) {
    throw new Error("Unauthorized")
  }
  if (!session.user.sellerAccess && session.user.role !== "admin") {
    throw new Error("Unauthorized: Seller access required")
  }
  return session.user
}
