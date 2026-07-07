/** Short month labels, index 0 = Jan. Shared by the BigQuery and reviews
 * display formatters so "2025-01" -> "Jan 2025" reads identically everywhere. */
export const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const
