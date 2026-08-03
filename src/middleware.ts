import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

// Session enforcement runs through the edge-safe authConfig (no DB adapter).
// The `authorized` callback in auth.config.ts decides what is public.
export const { auth: middleware } = NextAuth(authConfig)

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
