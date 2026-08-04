import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

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
  ],
  pages: {
    signIn: "/login",
    error: "/access-denied",
  },
}
