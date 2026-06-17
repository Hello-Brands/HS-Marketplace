import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getUsers, getAllowlist } from "./actions"
import { UsersManager } from "@/components/admin/UsersManager"

export default async function AdminUsersPage() {
  const session = await auth()

  if (!session?.user?.id || session.user.role !== "admin") {
    redirect("/")
  }

  const [userList, allowlistEntries] = await Promise.all([
    getUsers(),
    getAllowlist(),
  ])

  return (
    <UsersManager
      users={userList}
      allowlist={allowlistEntries}
      currentUserId={session.user.id}
    />
  )
}
