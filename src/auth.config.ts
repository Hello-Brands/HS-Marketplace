import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"
import Resend from "next-auth/providers/resend"
import { FROM_ADDRESS } from "@/lib/email"
import { MAGIC_LINK_MAX_AGE_SECONDS, sendMagicLinkEmail } from "@/lib/auth/magic-link-email"

/**
 * Provider/page config shared by the full Auth.js instance in src/auth.ts.
 *
 * This intentionally carries NO `authorized` callback. That callback only ever
 * runs inside a NextAuth instance used as middleware, and building one at the
 * edge is what broke sign-in: without the Drizzle adapter it resolves to the
 * `jwt` session strategy and tries to JWE-decode a cookie that holds an opaque
 * DATABASE session token, throwing `JWTSessionError: Invalid Compact JWE` on
 * every authenticated request. The edge gate is now a plain cookie-presence
 * check in src/middleware.ts, and the public-path list it enforces lives in
 * src/lib/auth-public-paths.ts. Adding `authorized` back here would be dead
 * code that reads like a security control.
 */
export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
    // Email magic link. The access gate for this provider is NOT here — it
    // lives in the `signIn` callback in src/auth.ts, which Auth.js runs BEFORE
    // `sendVerificationRequest` (see @auth/core/lib/actions/signin/send-token.js:
    // a string return short-circuits into a redirect and the email is never
    // sent). So a stranger who types an address into /login never receives a
    // link — they land on /access-denied.
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: FROM_ADDRESS,
      maxAge: MAGIC_LINK_MAX_AGE_SECONDS,
      sendVerificationRequest: sendMagicLinkEmail,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/access-denied",
    verifyRequest: "/check-email",
  },
}
