"use server"

import { requireAdmin } from "@/lib/auth-guards"
import * as core from "@/lib/admin/core/analytics"

export type { AnalyticsSummary, UserAnalyticsRow, LoginTrendPoint } from "@/lib/admin/core/analytics"

export async function getAnalyticsSummary() {
  await requireAdmin()
  return core.getAnalyticsSummary()
}

export async function getLoginTrend() {
  await requireAdmin()
  return core.getLoginTrend()
}

export async function getUserAnalytics() {
  await requireAdmin()
  return core.getUserAnalytics()
}
