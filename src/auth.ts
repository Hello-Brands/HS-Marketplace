import NextAuth from "next-auth"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { eq } from "drizzle-orm"
import { db } from "@/db"
import { users, accounts, sessions, verificationTokens, allowlist } from "@/db/schema/auth"
import { authConfig } from "./auth.config"
import { linkOwnerAtLogin } from "@/lib/owner-directory/login"
import { getEffectiveOwnerIdentifiers } from "@/lib/owner-directory/links"
import { recordLogin } from "@/lib/analytics/logins"
import { env } from "@/lib/env"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return false
      if (!profile?.email_verified) return false

      const email = profile.email as string
      const workspaceDomain = env.GOOGLE_WORKSPACE_DOMAIN || "hellosugar.salon"
      const isWorkspaceDomain = email.endsWith(`@${workspaceDomain}`)

      if (isWorkspaceDomain) {
        return true
      }

      // Non-franchisee: check allowlist
      const allowlistedUser = await db.query.allowlist.findFirst({
        where: eq(allowlist.email, email),
      })

      if (!allowlistedUser) {
        return "/access-denied"
      }

      return true
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
