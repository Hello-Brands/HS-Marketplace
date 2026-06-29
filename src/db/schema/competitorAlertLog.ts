import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core"
import { alerts } from "./alerts"

/**
 * App-owned ledger of competitor closures already accounted for per saved
 * search — both ones we've emailed and ones seeded as a baseline at save time.
 * Lets the weekly cron detect genuinely-new competitors without trusting the
 * scraper's `synced_at` (which is rewritten on every reconcile).
 *
 * `google_place_id` is NOT a foreign key — competitor_opportunities rows come
 * and go and the app never references into that table.
 */
export const competitorAlertLog = pgTable(
  "competitor_alert_log",
  {
    alertId: text("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    googlePlaceId: text("google_place_id").notNull(),
    alertedAt: timestamp("alerted_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.alertId, table.googlePlaceId] })],
)

export type CompetitorAlertLogRow = typeof competitorAlertLog.$inferSelect
