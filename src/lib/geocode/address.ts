// Pure address helpers (no network, no server-only) so both the geocode helper
// and the backfill script can use them.

/**
 * Unit designators whose following identifier is also noise ("Suite 12",
 * "Studio 15", "Salon 48"). Hello Sugar suites sit inside third-party salon
 * venues, so salon/studio/loft are unit words here, not street words.
 *
 * NOTE the absence of `fl`: it collided with the state of Florida and ate the
 * "FL 34205" tail off every Florida address. Floors are handled separately.
 */
const UNIT_WORDS =
  "suites?|ste|units?|apt|apartment|bldg|building|rm|room|salons?|studios?|lofts?"

/** Venue operators that appear in directory addresses without a unit number. */
const BRAND_WORDS = "sola|phenix|salons?|studios?|lofts?"

/**
 * Strip unit/suite/floor/venue noise from a US address so the geocoder matches
 * the street, not the suite. e.g. "1051 Glendon Avenue #111, Suites 108/109,
 * Los Angeles CA 90024" -> "1051 Glendon Avenue, Los Angeles CA 90024". This
 * lifts MapTiler relevance above the 0.8 accept threshold (measured 0.78 ->
 * 0.93 for the suite case, 0.778 -> 0.825 for the salon-brand case).
 *
 * A brand word is never stripped when it forms a city name — "Studio City" and
 * "Phenix City" are real places.
 */
export function cleanAddress(address: string): string {
  return address
    // Venue notes: "(inside Sola Salon Suites)".
    .replace(/\([^)]*\)/g, " ")
    // Ordinal floors ("2nd fl.", "3rd Floor") and "Floor 3", before UNIT_WORDS
    // so a bare "fl" can never be read as Florida.
    .replace(/\b\d+(?:st|nd|rd|th)\s+fl(?:oor)?\b\.?/gi, " ")
    .replace(/\bfloors?\s*\d+/gi, " ")
    // "Salons by JC" before UNIT_WORDS, which would otherwise consume "by" as
    // the unit identifier and strand "JC".
    .replace(/\b(?:salons?\s+)?by\s+jc\b/gi, " ")
    // A venue name at the START of the address is a prefix, not a unit
    // designator: in "Salon Lofts 1911 Falls Valley Drive" the number that
    // follows is the STREET number and must survive, whereas in "... Drive
    // Studio 15" it is the unit. Position is the only signal, so strip a leading
    // run of venue/unit words outright and let the rule below handle the rest.
    .replace(
      new RegExp(`^\\s*(?:my\\s+)?(?:(?:${BRAND_WORDS}|${UNIT_WORDS})\\b\\.?\\s*)+,?\\s*`, "i"),
      "",
    )
    // Unit designator plus its identifier, "#" included so the identifier is
    // consumed HERE. Stripping "#138" first would leave a bare "Suite" that
    // then eats the next token — which is often the city ("Suite #138 Houston").
    // The identifier may not be a city marker or another unit/brand word:
    // "Phenix Salon Suite 134" must not read "Suite" as Salon's identifier.
    .replace(
      new RegExp(
        `\\b(?:${UNIT_WORDS})\\b\\.?\\s*#?\\s*(?!city\\b)(?!(?:${UNIT_WORDS}|${BRAND_WORDS})\\b)[\\w/-]+`,
        "gi",
      ),
      " ",
    )
    // Any remaining "#111" / "#TBD" not attached to a unit word.
    .replace(/#\s*[\w/-]+/gi, " ")
    // Unit and brand words left bare once their identifier is gone, or used as a
    // prefix ("Salon Lofts 1911 ..."). These must NOT consume a following token —
    // that token is often the street number or the city.
    .replace(new RegExp(`\\b(?:${UNIT_WORDS}|${BRAND_WORDS})\\b(?!\\s+city\\b)\\.?`, "gi"), " ")
    // Separators and range leftovers: "Salon 48 & 49" -> "& 49", "Studios 11
    // and 13" -> "and 13".
    .replace(/[|:]/g, " ")
    .replace(/\s+&\s+[\w/-]+/g, " ")
    .replace(/\band\s+\d+[\w-]*/gi, " ")
    // Dangling prepositions from stripped venue names ("... in Phenix Salon").
    .replace(/\b(?:inside(?:\s+of)?|in)\s*(?=,|$)/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim()
}

/**
 * Ordered geocoder queries to try for one address, most specific first.
 *
 * A single query is not enough: MapTiler often scores a SIMPLER query much
 * higher, because a mall or plaza name in the middle of the address drags the
 * match down. Measured on the directory, dropping the city and keeping the ZIP
 * takes "3620 Kirkwood Hwy, Wilmington DE 19808" from 0.787 to 1.000, and does
 * the same for Palos Hills, Fort Mill, Katy, Houston and Woodbridge.
 *
 * Callers should try these in order and stop at the first acceptable match, so
 * the extra requests only happen for addresses that would otherwise have failed.
 */
export function buildGeocodeQueries(address: string): string[] {
  const queries = [cleanAddress(address)]

  const tail = parseUsAddressTail(address)
  if (tail) {
    const segments = address.split(",").map((s) => s.trim()).filter(Boolean)
    const street = cleanAddress(segments.slice(0, -1).join(", "))
    if (street) {
      queries.push(`${street}, ${tail.zipCode}`)
      queries.push(`${street}, ${tail.city} ${tail.state}`)
    }
  }

  return [...new Set(queries.filter((q) => q.length > 0))]
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
  const segments = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (segments.length === 0) return null

  const attempt = (segment: string) => {
    const m = segment.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
    return m ? { city: m[1].trim(), state: m[2].toUpperCase(), zipCode: m[3] } : null
  }

  const last = segments[segments.length - 1]
  const direct = attempt(last)
  if (direct) return direct

  // "777 Grassland Drive, American Fork, UT 84003" — the city is its own
  // segment, so the last one is just "ST ZIP" and doesn't match on its own.
  // This is common in the directory, and missing it cost both the map dot's
  // city/state label and the ZIP used to validate a geocoder match.
  //
  // Only join when the previous segment looks like a city: in "12823 N Dale
  // Mabry Hwy #6 Tampa, FL 33618" it is the whole street, and joining would
  // report that as the city. Rejecting on a digit keeps the old null there.
  if (segments.length >= 2) {
    const previous = segments[segments.length - 2]
    if (!/\d/.test(previous)) return attempt(`${previous} ${last}`)
  }

  return null
}
