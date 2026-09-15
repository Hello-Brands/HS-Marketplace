// Headline marketplace counts for the MCP `get_marketplace_overview` tool.
//
// NOT a use server module.
//
// Deliberately additive to PR A's getAnalyticsSummary rather than a replacement:
// that function is the admin analytics page's own source of truth for user and
// 30-day activity numbers, and the MCP must not be able to report a different
// figure than the page does. Only the numbers it does NOT carry are counted here.
import { count, eq, gte } from "drizzle-orm"
import { db } from "@/db"
import { listings } from "@/db/schema/listings"
import { users, allowlist } from "@/db/schema/auth"
import { brandRequests } from "@/db/schema/brandRequests"
import { contacts } from "@/db/schema/contacts"
import { loginEvents } from "@/db/schema/loginEvents"
import { getAnalyticsSummary } from "@/lib/admin/core/analytics"

/** Brand-request statuses that represent a decision already taken. */
const DECIDED_BRAND_REQUEST_STATUSES = ["approved", "building", "live", "rejected"] as const

export interface MarketplaceOverview {
  listings: { total: number; by_status: Record<string, number> }
  pending_queue: number
  brand_requests: { open: number; by_status: Record<string, number> }
  users: { total: number; admins: number; seller_access: number; allowlist_entries: number }
  engagement: {
    inquiries_7d: number
    inquiries_30d: number
    logins_7d: number
    logins_30d: number
    active_users_7d: number
  }
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

function tally(rows: { status: string | null; n: number }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    if (row.status) out[row.status] = row.n
  }
  return out
}

function scalar(rows: { n: number }[]): number {
  return rows[0]?.n ?? 0
}

export async function marketplaceOverview(): Promise<MarketplaceOverview> {
  const week = daysAgo(7)

  // The Promise.all order is load-bearing for the unit test's sequential mock:
  // keep new counts at the END of the array.
  const [
    summary,
    listingRows,
    brandRequestRows,
    adminRows,
    sellerRows,
    allowlistRows,
    inquiries7dRows,
    logins7dRows,
  ] = await Promise.all([
    getAnalyticsSummary(),
    db
      .select({ status: listings.status, n: count() })
      .from(listings)
      .groupBy(listings.status),
    db
      .select({ status: brandRequests.status, n: count() })
      .from(brandRequests)
      .groupBy(brandRequests.status),
    db.select({ n: count() }).from(users).where(eq(users.role, "admin")),
    db.select({ n: count() }).from(users).where(eq(users.sellerAccess, true)),
    db.select({ n: count() }).from(allowlist),
    db.select({ n: count() }).from(contacts).where(gte(contacts.createdAt, week)),
    db.select({ n: count() }).from(loginEvents).where(gte(loginEvents.createdAt, week)),
  ])

  const byStatus = tally(listingRows as { status: string | null; n: number }[])
  const brandByStatus = tally(brandRequestRows as { status: string | null; n: number }[])

  const open = Object.entries(brandByStatus)
    .filter(([status]) => !DECIDED_BRAND_REQUEST_STATUSES.includes(status as never))
    .reduce((sum, [, n]) => sum + n, 0)

  return {
    listings: {
      total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
      by_status: byStatus,
    },
    pending_queue: byStatus.pending ?? 0,
    brand_requests: { open, by_status: brandByStatus },
    users: {
      total: summary.totalUsers,
      admins: scalar(adminRows as { n: number }[]),
      seller_access: scalar(sellerRows as { n: number }[]),
      allowlist_entries: scalar(allowlistRows as { n: number }[]),
    },
    engagement: {
      inquiries_7d: scalar(inquiries7dRows as { n: number }[]),
      inquiries_30d: summary.inquiries30d,
      logins_7d: scalar(logins7dRows as { n: number }[]),
      logins_30d: summary.logins30d,
      active_users_7d: summary.activeThisWeek,
    },
  }
}
