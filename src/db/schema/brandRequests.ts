import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core"
import { users } from "./auth"

/**
 * Franchisee requests to monitor a new competitor brand.
 *
 * Lifecycle is SHARED with the external `competitor-monitor` repo: this app
 * inserts rows (status 'submitted') and records admin decisions ('approved' /
 * 'rejected'), then fires GitHub repository_dispatch events. The monitor's
 * GitHub Actions workflows UPDATE rows directly over their own DB connection —
 * status transitions ('recon_running', 'recon_complete', 'building', 'live',
 * 'needs_human') plus `recon`, `brand_id`, `pr_url`, `issue_url`,
 * `locations_found`, `error`, and `updated_at` all arrive as out-of-band
 * writes. Consequences:
 *   - Do NOT cache reads of this table; detail views must poll/refetch.
 *   - Column names/types are a CONTRACT with the monitor repo — change both
 *     sides or neither. Timestamps are timestamptz (monitor writes them from
 *     its own runtime), deviating from the app's bare-timestamp convention.
 *   - `recon` is monitor-written jsonb; treat every field as optional when
 *     rendering.
 */
export const BRAND_REQUEST_STATUSES = [
  "submitted",
  "recon_running",
  "recon_complete",
  "approved",
  "rejected",
  "building",
  "live",
  "needs_human",
] as const
export type BrandRequestStatus = (typeof BRAND_REQUEST_STATUSES)[number]

/** Shape the monitor's recon workflow writes into `recon`. All fields are
 * best-effort — render defensively. */
export type BrandRecon = {
  estLocationCount?: number
  estMonthlyCost?: number
  strategy?: string
  confidence?: string
  blockers?: string[]
  sampleLocations?: string[]
}

export const brandRequests = pgTable(
  "brand_requests",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    brandName: text("brand_name").notNull(),
    websiteUrl: text("website_url").notNull(),
    normalizedDomain: text("normalized_domain").notNull(),
    note: text("note"),
    knownCityState: text("known_city_state"),
    submittedBy: text("submitted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: BRAND_REQUEST_STATUSES })
      .default("submitted")
      .notNull(),
    recon: jsonb("recon").$type<BrandRecon>(),
    // The admin who approved/rejected; null while undecided.
    decidedBy: text("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rejectReason: text("reject_reason"),
    // Monitor-written: the brand_id it assigned (soft link to
    // monitored_brands — no FK; see that table's header).
    brandId: text("brand_id"),
    prUrl: text("pr_url"),
    issueUrl: text("issue_url"),
    locationsFound: integer("locations_found"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // Admin queue lists newest-first, optionally filtered by status.
    index("brand_requests_status_created_at_idx").on(
      table.status,
      table.createdAt.desc(),
    ),
    // FKs are not auto-indexed by Postgres.
    index("brand_requests_submitted_by_idx").on(table.submittedBy),
    index("brand_requests_decided_by_idx").on(table.decidedBy),
    // Submit-time dedupe looks rows up by domain.
    index("brand_requests_normalized_domain_idx").on(table.normalizedDomain),
  ],
)

export type BrandRequest = typeof brandRequests.$inferSelect
export type NewBrandRequest = typeof brandRequests.$inferInsert
