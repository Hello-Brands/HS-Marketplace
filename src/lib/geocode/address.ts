// Pure address helpers (no network, no server-only) so both the geocode helper
// and the backfill script can use them.

/**
 * Strip unit/suite/floor noise from a US address so the geocoder matches the
 * street, not the suite. e.g. "1051 Glendon Avenue #111, Suites 108/109, Los
 * Angeles CA 90024" -> "1051 Glendon Avenue, Los Angeles CA 90024". This lifts
 * MapTiler relevance well above the accept threshold (measured 0.78 -> 0.93).
 */
export function cleanAddress(address: string): string {
  return address
    .replace(/#\s*[\w/-]+/gi, "")
    .replace(
      /\b(suites?|ste|units?|apt|apartment|floors?|fl|bldg|building|rm|room)\b\.?\s*[\w/-]+/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim()
}

/**
 * Parse the trailing "City ST 12345" of a US address. The directory stores a
 * single combined address string, so this recovers the structured city/state/zip
 * for display (and gives the two-letter state abbreviation, which the geocoder
 * does not return — it gives the full state name).
 */
export function parseUsAddressTail(
  address: string,
): { city: string; state: string; zipCode: string } | null {
  const segment = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop()
  if (!segment) return null
  const m = segment.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
  if (!m) return null
  return { city: m[1].trim(), state: m[2].toUpperCase(), zipCode: m[3] }
}
