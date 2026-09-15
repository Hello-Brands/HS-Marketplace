// Saved buyer searches (`alerts`) joined to their owner, for the MCP `list_alerts` tool.
//
// NOT a use server module.
//
// Keyset, not offset: `alerts` grows at the head, so an offset page 2 would skip
// rows saved between the two calls. The cursor is (created_at, id) — id breaks
// ties within the same millisecond, exactly as the audit-log query does.
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { alerts } from "@/db/schema/alerts"
import { users } from "@/db/schema/auth"
import { encodeCursor, decodeCursor, money } from "@/lib/mcp/tools/_shared"

export interface AlertRow {
  id: string
  name: string | null
  origin: string
  owner: { id: string; name: string | null; email: string | null }
  states: string[] | null
  listing_types: string[] | null
  min_price: { cents: number; formatted: string } | null
  max_price: { cents: number; formatted: string } | null
  min_years_open: number | null
  inventory_included: boolean
  radius_miles: number | null
  center_label: string | null
  owner_identifier: string | null
  notify_enabled: boolean
  include_listings: boolean
  include_competitors: boolean
  created_at: string
  updated_at: string
}

export async function listAlerts(filters: {
  userId?: string
  origin?: string
  notifyEnabled?: boolean
  limit: number
  cursor?: string
}): Promise<{ items: AlertRow[]; next_cursor: string | null }> {
  const conditions: SQL[] = []
  if (filters.userId) conditions.push(eq(alerts.userId, filters.userId))
  if (filters.origin) conditions.push(eq(alerts.origin, filters.origin as never))
  if (filters.notifyEnabled !== undefined) {
    conditions.push(eq(alerts.notifyEnabled, filters.notifyEnabled))
  }

  const cursor = decodeCursor(filters.cursor)
  if (cursor && typeof cursor.at === "string" && typeof cursor.id === "string") {
    const at = new Date(cursor.at)
    if (!Number.isNaN(at.getTime())) {
      const keyset = or(
        lt(alerts.createdAt, at),
        and(eq(alerts.createdAt, at), lt(alerts.id, cursor.id)),
      )
      if (keyset) conditions.push(keyset)
    }
  }

  const rows = await db
    .select({
      id: alerts.id,
      name: alerts.name,
      origin: alerts.origin,
      userId: alerts.userId,
      userName: users.name,
      userEmail: users.email,
      states: alerts.states,
      listingTypes: alerts.listingTypes,
      minPrice: alerts.minPrice,
      maxPrice: alerts.maxPrice,
      minYearsOpen: alerts.minYearsOpen,
      inventoryIncluded: alerts.inventoryIncluded,
      radiusMiles: alerts.radiusMiles,
      centerLabel: alerts.centerLabel,
      ownerIdentifier: alerts.ownerIdentifier,
      notifyEnabled: alerts.notifyEnabled,
      includeListings: alerts.includeListings,
      includeCompetitors: alerts.includeCompetitors,
      createdAt: alerts.createdAt,
      updatedAt: alerts.updatedAt,
    })
    .from(alerts)
    .leftJoin(users, eq(users.id, alerts.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(alerts.createdAt), desc(alerts.id))
    .limit(filters.limit + 1)

  const hasMore = rows.length > filters.limit
  const page = hasMore ? rows.slice(0, filters.limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map((r) => ({
      id: r.id,
      name: r.name,
      origin: r.origin,
      owner: { id: r.userId, name: r.userName, email: r.userEmail },
      states: r.states,
      listing_types: r.listingTypes,
      // min_price/max_price are stored in cents like every other money column.
      min_price: money(r.minPrice),
      max_price: money(r.maxPrice),
      min_years_open: r.minYearsOpen,
      inventory_included: r.inventoryIncluded,
      radius_miles: r.radiusMiles,
      center_label: r.centerLabel,
      owner_identifier: r.ownerIdentifier,
      notify_enabled: r.notifyEnabled,
      include_listings: r.includeListings,
      include_competitors: r.includeCompetitors,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    })),
    next_cursor:
      hasMore && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null,
  }
}
