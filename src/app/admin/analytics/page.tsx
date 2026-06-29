import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getAnalyticsSummary, getUserAnalytics, getLoginTrend } from "./actions"
import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard"

export default async function AdminAnalyticsPage() {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== "admin") {
    redirect("/")
  }

  const [summary, users, trend] = await Promise.all([
    getAnalyticsSummary(),
    getUserAnalytics(),
    getLoginTrend(),
  ])

  return <AnalyticsDashboard summary={summary} users={users} trend={trend} />
}
