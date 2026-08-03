import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

// Paths reachable without a session. These either ARE the auth flow, or they
// authenticate by a secret/token instead of the session cookie (Vercel cron
// jobs via CRON_SECRET, no-login email action links via ACTION_TOKEN_SECRET).
// Gating them would break sign-in, the cron emails, and the action links.
const PUBLIC_PATHS = [
  "/login",
  "/access-denied",
  "/action-complete", // no-login email action landing page
  "/api/auth", // Auth.js sign-in/callback endpoints
  "/api/actions", // token-authed email action links
  "/api/cron", // CRON_SECRET-authed Vercel cron jobs
]

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/access-denied",
  },
  callbacks: {
    // Full-gate: every route requires a session except the public paths above.
    // Runs in the edge middleware, so it must stay free of DB / Node-only deps.
    authorized({ request, auth }) {
      const { pathname } = request.nextUrl
      const isPublic = PUBLIC_PATHS.some(
        (p) => pathname === p || pathname.startsWith(`${p}/`),
      )
      if (isPublic) return true
      // Check for a real user, not just a truthy `auth` object. The Auth.js
      // advisory cleared by the next-auth beta.32 bump was precisely that a
      // configuration error can populate `auth` with an error payload, so an
      // existence-only check (`!!auth`) fails OPEN. Requiring `auth.user` fails
      // closed regardless of the library version.
      return !!auth?.user
    },
  },
}
