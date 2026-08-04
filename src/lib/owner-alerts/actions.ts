"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { reconcileOwnerAutoAlerts } from "./reconcile"

/**
 * One-time owner closure-alerts choice. Enabling immediately creates the
 * 3-mile owner-auto searches via the reconciler.
 */
export async function chooseOwnerAlerts(choice: "enabled" | "declined") {
  const session = await auth()
  if (!session?.user?.id) return { error: "Not authenticated" }
  if (choice !== "enabled" && choice !== "declined") return { error: "Invalid choice" }

  await db.update(users).set({ ownerAlertsChoice: choice }).where(eq(users.id, session.user.id))
  if (choice === "enabled") await reconcileOwnerAutoAlerts(session.user.id)

  revalidatePath("/account/alerts")
  revalidatePath("/browse")
  return { success: true }
}
