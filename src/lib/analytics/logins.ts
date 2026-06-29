import { db } from '@/db'
import { loginEvents } from '@/db/schema/loginEvents'
import { users } from '@/db/schema/auth'
import { eq, sql } from 'drizzle-orm'

/**
 * Record a successful login: append a login_events row and bump the
 * denormalized counters on the user. Never throws into the auth flow — callers
 * wrap it so a tracking failure can't block sign-in.
 */
export async function recordLogin(userId: string): Promise<void> {
  if (!userId) return
  await db.insert(loginEvents).values({ userId })
  await db
    .update(users)
    .set({ loginCount: sql`${users.loginCount} + 1`, lastLoginAt: new Date() })
    .where(eq(users.id, userId))
}
