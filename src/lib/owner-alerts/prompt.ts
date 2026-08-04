import "server-only"
import { eq } from "drizzle-orm"
import { auth } from "@/auth"
import { db } from "@/db"
import { users } from "@/db/schema/auth"

/**
 * Show the one-time prompt only to users who hold ≥1 effective owner link and
 * have never answered. Resilient: any failure hides the prompt.
 */
export async function shouldShowOwnerAlertsPrompt(): Promise<boolean> {
  try {
    const session = await auth()
    if (!session?.user?.id) return false
    if ((session.user.ownerIdentifiers?.length ?? 0) === 0) return false
    const row = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { ownerAlertsChoice: true },
    })
    return row?.ownerAlertsChoice == null
  } catch (err) {
    console.warn("[owner-alerts] prompt visibility check failed:", err)
    return false
  }
}
