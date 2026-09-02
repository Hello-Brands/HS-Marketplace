import NextAuth from "next-auth"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { users, accounts, sessions, verificationTokens, allowlist } from "@/db/schema/auth"
import { authConfig } from "./auth.config"
import { linkOwnerAtLogin } from "@/lib/owner-directory/login"
import { getEffectiveOwnerIdentifiers } from "@/lib/owner-directory/links"
import { reconcileOwnerAutoAlerts } from "@/lib/owner-alerts/reconcile"
import { recordLogin } from "@/lib/analytics/logins"
import { env } from "@/lib/env"
import { checkRateLimit } from "@/lib/rate-limit"
import { decideAccess, normalizeSignInEmail, type AccessGateDeps } from "@/lib/auth/access-gate"
import { MAGIC_LINK_MAX_AGE_SECONDS } from "@/lib/auth/magic-link-email"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  callbacks: {
    // authConfig carries no callbacks of its own — see the note in
    // auth.config.ts on why `authorized` deliberately does not live there.
    async signIn({ user, account, profile, email }) {
      // One access rule for every provider (src/lib/auth/access-gate.ts):
      // workspace domain, else admin allowlist, else denied.
      const deps: AccessGateDeps = {
        workspaceDomain: env.GOOGLE_WORKSPACE_DOMAIN || "hellosugar.salon",
        // One query for both entry kinds: the address itself and its exact
        // "@domain" entry (a whole-company grant an admin added).
        isAllowlisted: async (candidates) =>
          !!(await db.query.allowlist.findFirst({
            where: inArray(allowlist.email, candidates),
          })),
      }

      if (account?.provider === "google") {
        if (!profile?.email_verified) return false
        const decision = await decideAccess(profile.email as string, deps)
        return decision === "denied" ? "/access-denied" : true
      }

      if (account?.provider === "resend") {
        // This callback fires TWICE for an email provider: once before the mail
        // goes out (`email.verificationRequest === true`) and again when the
        // recipient clicks the link. Gating the pre-send phase is what stops a
        // stranger from making us mail a sign-in link to an address they typed
        // in — Auth.js turns a returned string into a redirect and skips
        // `sendVerificationRequest` entirely.
        const address = user?.email
        if (!address) return false

        const decision = await decideAccess(address, deps)
        if (decision === "denied") return "/access-denied"

        if (email?.verificationRequest) {
          // Runs AFTER the access gate on purpose, so only addresses that are
          // actually allowed to sign in occupy a slot in the in-memory map.
          const rl = checkRateLimit(
            `magic-link:${normalizeSignInEmail(address)}`,
            3,
            MAGIC_LINK_MAX_AGE_SECONDS * 1000,
          )
          // Pretend it was sent: no extra mail, no signal back to the caller,
          // and the user sees the same page either way.
          if (!rl.allowed) return "/check-email"
        }

        return true
      }

      return false
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
        session.user.role = user.role
        session.user.sellerAccess = user.sellerAccess
        // Owner links live in user_owner_links (a user may hold several owner
        // profiles), so this is one indexed lookup rather than a column on the
        // adapter's user row. Read fresh so an admin revoke takes effect on the
        // next page load instead of requiring sign-out. A failure must degrade
        // to "not an owner", never break the session.
        try {
          session.user.ownerIdentifiers = await getEffectiveOwnerIdentifiers(user.id)
        } catch (err) {
          console.warn("[owner-link] session owner lookup failed (non-fatal):", err)
          session.user.ownerIdentifiers = []
        }
      }
      return session
    },
  },
  events: {
    // Additive: link a logged-in user to their owner directory record by email.
    // Runs on every sign-in (so existing users get linked once the directory
    // syncs), never blocks login.
    async signIn({ user }) {
      if (user.id) {
        await linkOwnerAtLogin(user.id, user.email)
        // Runs after the link step so freshly linked owners reconcile on the
        // same sign-in. Never throws.
        await reconcileOwnerAutoAlerts(user.id)
        // Never let a tracking failure block login.
        try {
          await recordLogin(user.id)
        } catch (err) {
          console.error("recordLogin failed", err)
        }
      }
    },
    async createUser({ user }) {
      // Bootstrap first admin on account creation
      const initialAdminEmail = env.INITIAL_ADMIN_EMAIL
      if (initialAdminEmail && user.email === initialAdminEmail) {
        await db.update(users)
          .set({ role: "admin" })
          .where(eq(users.email, initialAdminEmail))
      }

      // Grant seller access to all franchisees by default
      const workspaceDomain = env.GOOGLE_WORKSPACE_DOMAIN || "hellosugar.salon"
      if (user.id && user.email?.endsWith(`@${workspaceDomain}`)) {
        await db.update(users)
          .set({ sellerAccess: true })
          .where(eq(users.id, user.id))
      }
    },
  },
  debug: process.env.NODE_ENV === "development",
})
