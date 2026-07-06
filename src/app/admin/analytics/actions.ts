"use server"

import { db } from "@/db"
import { users } from "@/db/schema/auth"
import { listings } from "@/db/schema/listings"
import { contacts } from "@/db/schema/contacts"
import { favorites } from "@/db/schema/favorites"
import { loginEvents } from "@/db/schema/loginEvents"
import { count, countDistinct, eq, gte, sql } from "drizzle-orm"
import { fillTrend, type LoginTrendPoint } from "./trend"
import { requireAdmin } from "@/lib/auth-guards"

export type { LoginTrendPoint }

export interface AnalyticsSummary {
  totalUsers: number
  activeThisWeek: number
  logins30d: number
  inquiries30d: number
}

export interface UserAnalyticsRow {
  id: string
  name: string | null
  email: string | null
  role: string
  loginCount: number
  lastLoginAt: Date | null
  listingsPosted: number
  reachOutsSent: number
  inquiriesReceived: number
  savesMade: number
  spark: number[]
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  await requireAdmin()
  const [[totalUsers], [activeThisWeek], [logins30d], [inquiries30d]] = await Promise.all([
    db.select({ v: count() }).from(users),
    db.select({ v: countDistinct(loginEvents.userId) }).from(loginEvents)
      .where(gte(loginEvents.createdAt, daysAgo(7))),
    db.select({ v: count() }).from(loginEvents).where(gte(loginEvents.createdAt, daysAgo(30))),
    db.select({ v: count() }).from(contacts).where(gte(contacts.createdAt, daysAgo(30))),
  ])
  return {
    totalUsers: totalUsers?.v ?? 0,
    activeThisWeek: activeThisWeek?.v ?? 0,
    logins30d: logins30d?.v ?? 0,
    inquiries30d: inquiries30d?.v ?? 0,
  }
}

export async function getLoginTrend(): Promise<LoginTrendPoint[]> {
  await requireAdmin()
  const day = sql<string>`to_char(${loginEvents.createdAt}, 'YYYY-MM-DD')`
  const rows = await db
    .select({ date: day, count: count() })
    .from(loginEvents)
    .where(gte(loginEvents.createdAt, daysAgo(30)))
    .groupBy(day)
  return fillTrend(rows, 30, new Date())
}

export async function getUserAnalytics(): Promise<UserAnalyticsRow[]> {
  await requireAdmin()

  const day = sql<string>`to_char(${loginEvents.createdAt}, 'YYYY-MM-DD')`
  const [
    userRows,
    listingRows,
    reachOutRows,
    inquiryRows,
    saveRows,
    sparkRows,
  ] = await Promise.all([
    db.select({
      id: users.id, name: users.name, email: users.email, role: users.role,
      loginCount: users.loginCount, lastLoginAt: users.lastLoginAt,
    }).from(users).orderBy(users.createdAt),
    db.select({ sellerId: listings.sellerId, v: count() }).from(listings).groupBy(listings.sellerId),
    db.select({ buyerId: contacts.buyerId, v: count() }).from(contacts).groupBy(contacts.buyerId),
    db.select({ sellerId: listings.sellerId, v: count() })
      .from(contacts).innerJoin(listings, eq(contacts.listingId, listings.id))
      .groupBy(listings.sellerId),
    db.select({ userId: favorites.userId, v: count() }).from(favorites).groupBy(favorites.userId),
    db.select({ userId: loginEvents.userId, date: day, v: count() })
      .from(loginEvents).where(gte(loginEvents.createdAt, daysAgo(7)))
      .groupBy(loginEvents.userId, day),
  ])

  const listingsBy = new Map(listingRows.map((r) => [r.sellerId, r.v]))
  const reachBy = new Map(reachOutRows.map((r) => [r.buyerId, r.v]))
  const inqBy = new Map(inquiryRows.map((r) => [r.sellerId, r.v]))
  const saveBy = new Map(saveRows.map((r) => [r.userId, r.v]))

  // Build the last-7-days date labels (oldest first) for sparkline alignment.
  const today = new Date()
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const sparkDates: string[] = []
  for (let i = 6; i >= 0; i--) sparkDates.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10))
  const sparkBy = new Map<string, Map<string, number>>()
  for (const r of sparkRows) {
    if (!sparkBy.has(r.userId)) sparkBy.set(r.userId, new Map())
    sparkBy.get(r.userId)!.set(r.date, r.v)
  }

  return userRows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    loginCount: u.loginCount,
    lastLoginAt: u.lastLoginAt,
    listingsPosted: listingsBy.get(u.id) ?? 0,
    reachOutsSent: reachBy.get(u.id) ?? 0,
    inquiriesReceived: inqBy.get(u.id) ?? 0,
    savesMade: saveBy.get(u.id) ?? 0,
    spark: sparkDates.map((d) => sparkBy.get(u.id)?.get(d) ?? 0),
  }))
}
