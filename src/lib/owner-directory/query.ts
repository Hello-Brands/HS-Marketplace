import "server-only"
import { runQuery } from "@/lib/bigquery/client"

/** The owner directory: one row per owner-location. */
const DIRECTORY_SQL = `
  SELECT
    owner_identifier, owner_name, owner_contact_email,
    blvd_location_name, blvd_location_number, location_address,
    actual_suite_go_date, suite_closed_date,
    actual_flagship_go_date, flagship_closed_date
  FROM \`even-affinity-388602.data_mart_for_tools.vw_monday_data_raw\`
  WHERE blvd_location_name IS NOT NULL
  ORDER BY owner_identifier, blvd_location_name`

/** The literal owner_identifier used for closed/unmapped rows. Never linkable. */
export const UNKNOWN_OWNER = "Unknown Owner"

/** A BigQuery DATE arrives as { value: "YYYY-MM-DD" } | "YYYY-MM-DD" | "" | null. */
type BqDate = { value: string } | string | null | undefined

export type DirectoryRow = {
  owner_identifier: string
  owner_name: string | null
  owner_contact_email: string | null
  blvd_location_name: string
  blvd_location_number: string | null
  location_address: string | null
  actual_suite_go_date: BqDate
  suite_closed_date: BqDate
  actual_flagship_go_date: BqDate
  flagship_closed_date: BqDate
}

/** Parse a BigQuery DATE into a JS Date; "" / null / invalid -> null. */
export function parseBqDate(v: BqDate): Date | null {
  const s = (v && typeof v === "object" ? v.value : v) ?? ""
  if (!s) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Fetch all directory rows from BigQuery. Returns null when BigQuery is not
 * configured / the query fails (callers treat this as "cannot sync"), never
 * a partial result.
 */
export async function fetchOwnerDirectory(): Promise<DirectoryRow[] | null> {
  return runQuery<DirectoryRow>(DIRECTORY_SQL)
}
