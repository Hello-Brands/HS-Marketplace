/**
 * Admin activity feed: one time-ordered stream built from the audit log plus
 * the timestamps the app already records. Used by /admin/activity and the MCP
 * `list_recent_activity` tool.
 *
 * NOT a `"use server"` file. Does not check auth — callers do.
 *
 * Implementation note: a single UNION ALL over raw SQL. Every branch selects
 * the same 9 columns so Postgres can union them; timestamps are cast to
 * timestamptz because `listings`/`contacts`/... use `timestamp` while the
 * audit log and brand requests use `timestamptz`.
 */
import { sql, type SQL } from "drizzle-orm"
import { db } from "@/db"

export const ACTIVITY_KINDS = [
  "admin_action",
  "listing_created",
  "listing_listed",
  "listing_updated",
  "inquiry",
  "favorite",
  "login",
  "brand_request_submitted",
  "brand_request_decided",
  "owner_link_changed",
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export interface ActivityItem {
  at: Date
  kind: ActivityKind
  id: string
  actor: { id: string; name: string | null; email: string | null } | null
  target: { type: string; id: string; label: string | null } | null
  summary: string
  source?: "ui" | "mcp"
}

/** Shape of one row coming back from the UNION query. Exported for tests. */
export interface ActivityRawRow {
  at: Date | string
  kind: ActivityKind
  id: string
  actor_id: string | null
  actor_name: string | null
  actor_email: string | null
  target_type: string | null
  target_id: string | null
  target_label: string | null
  /** admin_action: the action name; brand_request_decided: status; owner_link_changed: source */
  detail: string | null
  source: "ui" | "mcp" | null
  outcome: "ok" | "error" | null
}

export interface ActivityCursor {
  at: Date
  kind: ActivityKind
  id: string
}

export function encodeActivityCursor(c: ActivityCursor): string {
  return Buffer.from(JSON.stringify({ at: c.at.toISOString(), kind: c.kind, id: c.id })).toString("base64url")
}

export function decodeActivityCursor(cursor: string | null | undefined): ActivityCursor | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      at?: unknown
      kind?: unknown
      id?: unknown
    }
    if (typeof parsed.at !== "string" || typeof parsed.id !== "string") return null
    if (!ACTIVITY_KINDS.includes(parsed.kind as ActivityKind)) return null
    const at = new Date(parsed.at)
    if (Number.isNaN(at.getTime())) return null
    return { at, kind: parsed.kind as ActivityKind, id: parsed.id }
  } catch {
    return null
  }
}

const ACTION_VERBS: Record<string, string> = {
  "listing.approve": "approved",
  "listing.reject": "rejected",
  "listing.update": "edited",
  "listing.mark_sold": "marked sold",
  "user.set_role": "changed role of",
  "user.set_seller_access": "changed seller access for",
  "user.remove": "removed",
  "allowlist.add": "allowlisted",
  "allowlist.remove": "removed from allowlist",
  "brand_request.approve": "approved",
  "brand_request.reject": "rejected",
  "brand_request.retry_dispatch": "retried dispatch for",
  "owner_link.add": "linked owner for",
  "owner_link.revoke": "revoked owner link for",
  "owner_link.clear": "cleared owner link for",
  "owner_directory.refresh": "refreshed",
  "listing_location.set_data_mapping": "set data mapping for",
  "mcp_token.revoke": "revoked MCP connection",
}

const TARGET_NOUNS: Record<string, string> = {
  listing: "listing",
  user: "user",
  allowlist: "allowlist entry",
  brand_request: "brand request",
  owner_link: "owner link",
  listing_location: "location",
  owner_directory: "owner directory",
  mcp_token: "MCP connection",
}

function quote(label: string | null): string {
  return label ? `“${label}”` : ""
}

function actorLabel(row: ActivityRawRow): string {
  return row.actor_name || row.actor_email || "Someone"
}

export function summarizeActivity(row: ActivityRawRow): string {
  const who = actorLabel(row)
  const label = quote(row.target_label)
  switch (row.kind) {
    case "admin_action": {
      const verb = ACTION_VERBS[row.detail ?? ""] ?? row.detail ?? "acted on"
      const noun = TARGET_NOUNS[row.target_type ?? ""] ?? ""
      const parts = [who, verb, noun, label].filter(Boolean).join(" ")
      const via = row.source === "mcp" ? " via MCP" : ""
      const failed = row.outcome === "error" ? " (failed)" : ""
      return `${parts}${via}${failed}`
    }
    case "listing_created":
      return `${who} created listing ${label}`.trim()
    case "listing_listed":
      return `Listing ${label} went live`
    case "listing_updated":
      return `Listing ${label} was updated`
    case "inquiry":
      return `${who} inquired about ${label}`.trim()
    case "favorite":
      return `${who} saved ${label}`.trim()
    case "login":
      return `${who} signed in`
    case "brand_request_submitted":
      return `${who} requested brand ${label}`.trim()
    case "brand_request_decided":
      return `${who} ${row.detail ?? "decided"} brand request ${label}`.trim()
    case "owner_link_changed":
      return `${who} set owner link for ${label} to ${row.detail ?? "unknown"}`
  }
}

const UNION_SQL = sql`
  SELECT a.created_at::timestamptz AS at, 'admin_action' AS kind, a.id AS id, a.actor_user_id AS actor_id,
         a.target_type AS target_type, a.target_id AS target_id, a.action AS detail, a.source AS source, a.outcome AS outcome
    FROM admin_audit_log a WHERE a.action <> 'mcp.read'
  UNION ALL
  SELECT l.created_at::timestamptz, 'listing_created', l.id, l.seller_id, 'listing', l.id, NULL, NULL, NULL FROM listings l
  UNION ALL
  SELECT l.listed_at::timestamptz, 'listing_listed', l.id, l.seller_id, 'listing', l.id, NULL, NULL, NULL FROM listings l WHERE l.listed_at IS NOT NULL
  UNION ALL
  SELECT l.updated_at::timestamptz, 'listing_updated', l.id, l.seller_id, 'listing', l.id, NULL, NULL, NULL FROM listings l WHERE l.updated_at <> l.created_at
  UNION ALL
  SELECT c.created_at::timestamptz, 'inquiry', c.id, c.buyer_id, 'listing', c.listing_id, NULL, NULL, NULL FROM contacts c
  UNION ALL
  SELECT f.created_at::timestamptz, 'favorite', f.id, f.user_id, 'listing', f.listing_id, NULL, NULL, NULL FROM favorites f
  UNION ALL
  SELECT e.created_at::timestamptz, 'login', e.id, e.user_id, 'user', e.user_id, NULL, NULL, NULL FROM login_events e
  UNION ALL
  SELECT b.created_at::timestamptz, 'brand_request_submitted', b.id, b.submitted_by, 'brand_request', b.id, NULL, NULL, NULL FROM brand_requests b
  UNION ALL
  SELECT b.decided_at::timestamptz, 'brand_request_decided', b.id, b.decided_by, 'brand_request', b.id, b.status, NULL, NULL FROM brand_requests b WHERE b.decided_at IS NOT NULL
  UNION ALL
  SELECT u.updated_at::timestamptz, 'owner_link_changed', u.id, u.actor_user_id, 'user', u.user_id, u.source, NULL, NULL FROM user_owner_links u
`

export async function getRecentActivity(opts: {
  kinds?: ActivityKind[]
  actorUserId?: string
  since?: Date
  cursor?: string | null
  limit: number
}): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit, 100))
  const where: SQL[] = [sql`ev.at IS NOT NULL`]

  if (opts.kinds && opts.kinds.length > 0) {
    const valid = opts.kinds.filter((k) => ACTIVITY_KINDS.includes(k))
    if (valid.length > 0) {
      where.push(sql`ev.kind IN (${sql.join(valid.map((k) => sql`${k}`), sql`, `)})`)
    }
  }
  if (opts.actorUserId) where.push(sql`ev.actor_id = ${opts.actorUserId}`)
  if (opts.since) where.push(sql`ev.at >= ${opts.since.toISOString()}::timestamptz`)

  const cursor = decodeActivityCursor(opts.cursor)
  if (cursor) {
    where.push(
      sql`(ev.at, ev.kind, ev.id) < (${cursor.at.toISOString()}::timestamptz, ${cursor.kind}, ${cursor.id})`,
    )
  }

  const query = sql`
    SELECT ev.at, ev.kind, ev.id, ev.actor_id,
           act.name AS actor_name, act.email AS actor_email,
           ev.target_type, ev.target_id,
           CASE ev.target_type
             WHEN 'listing' THEN tl.title
             WHEN 'user' THEN COALESCE(tu.name, tu.email)
             WHEN 'brand_request' THEN tb.brand_name
             ELSE ev.target_id
           END AS target_label,
           ev.detail, ev.source, ev.outcome
      FROM (${UNION_SQL}) ev
      LEFT JOIN users act ON act.id = ev.actor_id
      LEFT JOIN listings tl ON ev.target_type = 'listing' AND tl.id = ev.target_id
      LEFT JOIN users tu ON ev.target_type = 'user' AND tu.id = ev.target_id
      LEFT JOIN brand_requests tb ON ev.target_type = 'brand_request' AND tb.id = ev.target_id
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY ev.at DESC, ev.kind DESC, ev.id DESC
     LIMIT ${limit + 1}
  `

  const { rows } = (await db.execute(query)) as unknown as { rows: ActivityRawRow[] }
  const page = rows.slice(0, limit)
  const items: ActivityItem[] = page.map((r) => ({
    at: r.at instanceof Date ? r.at : new Date(r.at),
    kind: r.kind,
    id: r.id,
    actor: r.actor_id ? { id: r.actor_id, name: r.actor_name, email: r.actor_email } : null,
    target: r.target_type && r.target_id ? { type: r.target_type, id: r.target_id, label: r.target_label } : null,
    summary: summarizeActivity(r),
    ...(r.source ? { source: r.source } : {}),
  }))
  const last = items[items.length - 1]
  const nextCursor = rows.length > limit && last ? encodeActivityCursor({ at: last.at, kind: last.kind, id: last.id }) : null
  return { items, nextCursor }
}
