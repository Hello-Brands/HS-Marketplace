// Direct reads of brand_requests for the MCP.
//
// NOT a use server module.
//
// NEVER CACHE THESE. The external Hello-Brands/competitor-monitor repo writes this
// table directly (status, recon, brand_id, pr_url, locations_found, error) with no
// callback into this app, so any cached copy would show an admin a stale pipeline
// state and invite a duplicate approval. Plain queries, every call.
import { and, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm"
import { db } from "@/db"
import { brandRequests, type BrandRequestStatus } from "@/db/schema/brandRequests"
import { users } from "@/db/schema/auth"
import { encodeCursor, decodeCursor } from "@/lib/mcp/tools/_shared"

export interface BrandRequestRow {
  id: string
  brand_name: string
  website_url: string
  normalized_domain: string
  status: string
  note: string | null
  known_city_state: string | null
  submitted_by: { id: string | null; name: string | null; email: string | null }
  decided_by: string | null
  /** ISO 8601. */
  decided_at: string | null
  reject_reason: string | null
  brand_id: string | null
  pr_url: string | null
  issue_url: string | null
  locations_found: number | null
  error: string | null
  /** ISO 8601. */
  created_at: string
  /** ISO 8601. */
  updated_at: string
}

const columns = {
  id: brandRequests.id,
  brandName: brandRequests.brandName,
  websiteUrl: brandRequests.websiteUrl,
  normalizedDomain: brandRequests.normalizedDomain,
  status: brandRequests.status,
  note: brandRequests.note,
  knownCityState: brandRequests.knownCityState,
  submittedBy: brandRequests.submittedBy,
  submitterName: users.name,
  submitterEmail: users.email,
  decidedBy: brandRequests.decidedBy,
  decidedAt: brandRequests.decidedAt,
  rejectReason: brandRequests.rejectReason,
  brandId: brandRequests.brandId,
  prUrl: brandRequests.prUrl,
  issueUrl: brandRequests.issueUrl,
  locationsFound: brandRequests.locationsFound,
  error: brandRequests.error,
  recon: brandRequests.recon,
  createdAt: brandRequests.createdAt,
  updatedAt: brandRequests.updatedAt,
}

/**
 * The one selection both reads share. The submitter join is a LEFT join even though
 * `submitted_by` is NOT NULL: a deleted user cascades the request away, but reading
 * through a left join means a future soft-delete cannot make requests vanish here.
 */
function baseQuery() {
  return db
    .select(columns)
    .from(brandRequests)
    .leftJoin(users, eq(users.id, brandRequests.submittedBy))
}

type BrandRequestQueryRow = Awaited<ReturnType<typeof baseQuery>>[number]

function project(r: BrandRequestQueryRow): BrandRequestRow {
  return {
    id: r.id,
    brand_name: r.brandName,
    website_url: r.websiteUrl,
    normalized_domain: r.normalizedDomain,
    status: r.status,
    note: r.note,
    known_city_state: r.knownCityState,
    submitted_by: { id: r.submittedBy, name: r.submitterName, email: r.submitterEmail },
    decided_by: r.decidedBy,
    decided_at: r.decidedAt ? r.decidedAt.toISOString() : null,
    reject_reason: r.rejectReason,
    brand_id: r.brandId,
    pr_url: r.prUrl,
    issue_url: r.issueUrl,
    locations_found: r.locationsFound,
    error: r.error,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  }
}

export async function listBrandRequests(filters: {
  status?: string
  search?: string
  limit: number
  cursor?: string
}): Promise<{ items: BrandRequestRow[]; next_cursor: string | null }> {
  const conditions: SQL[] = []
  // The column is an enum-typed text; the filter is a free string so an unknown
  // status simply matches no rows instead of failing to compile.
  if (filters.status) conditions.push(eq(brandRequests.status, filters.status as BrandRequestStatus))
  if (filters.search) {
    const term = `%${filters.search.trim()}%`
    const matches = or(
      ilike(brandRequests.brandName, term),
      ilike(brandRequests.normalizedDomain, term),
    )
    if (matches) conditions.push(matches)
  }

  // Keyset, not offset: the monitor repo is writing to this table concurrently, so
  // an offset page 2 could skip or repeat rows. The cursor is (created_at, id).
  const cursor = decodeCursor(filters.cursor)
  if (cursor && typeof cursor.at === "string" && typeof cursor.id === "string") {
    const at = new Date(cursor.at)
    if (!Number.isNaN(at.getTime())) {
      const keyset = or(
        lt(brandRequests.createdAt, at),
        and(eq(brandRequests.createdAt, at), lt(brandRequests.id, cursor.id)),
      )
      if (keyset) conditions.push(keyset)
    }
  }

  // Fetch one extra row: its presence is how we know another page exists without
  // paying for a second COUNT query.
  const rows = await baseQuery()
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(brandRequests.createdAt), desc(brandRequests.id))
    .limit(filters.limit + 1)

  const hasMore = rows.length > filters.limit
  const page = hasMore ? rows.slice(0, filters.limit) : rows
  const last = page[page.length - 1]

  return {
    items: page.map(project),
    next_cursor:
      hasMore && last
        ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id })
        : null,
  }
}

export async function getBrandRequestDetail(
  id: string,
): Promise<(BrandRequestRow & { recon: unknown }) | null> {
  const rows = await baseQuery().where(eq(brandRequests.id, id)).limit(1)

  const row = rows[0]
  if (!row) return null
  return { ...project(row), recon: row.recon ?? null }
}
