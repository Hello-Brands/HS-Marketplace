import { normalizeName, suggestLocationMatch } from "@/lib/data/match"

export type BlvdMatchMethod =
  | "number_exact"
  | "name_exact"
  | "name_fuzzy"
  | "unmatched"
export type BlvdMatchConfidence = "high" | "medium" | "low" | "none"

export type LocationResolution = {
  /** The matched BigQuery LOCATION_NAME (financial join key), or null. */
  resolvedBqLocationName: string | null
  method: BlvdMatchMethod
  confidence: BlvdMatchConfidence
}

/**
 * Jaccard score (from suggestLocationMatch) at/above this counts as a medium
 * fuzzy match; the band [0.5, this) is a low fuzzy match (stored as a candidate
 * but should be human-reviewed before it drives financials). Tunable.
 */
export const FUZZY_MEDIUM_MIN = 0.75

const UNMATCHED: LocationResolution = {
  resolvedBqLocationName: null,
  method: "unmatched",
  confidence: "none",
}

/**
 * Resolve a directory `blvd_location_name` to a BigQuery LOCATION_NAME.
 *
 * There is no Boulevard numeric id in this system, so `number_exact` is never
 * produced — resolution is purely name-based against the live LOCATION_NAME
 * list. Reuses the existing normalizeName/suggestLocationMatch helpers so the
 * owner directory matches the same way the admin Data Mappings screen does.
 *
 *  - exact normalized-name match  -> name_exact / high
 *  - fuzzy >= FUZZY_MEDIUM_MIN     -> name_fuzzy / medium
 *  - fuzzy in [0.5, MEDIUM_MIN)    -> name_fuzzy / low
 *  - below the 0.5 floor / no list -> unmatched / none
 */
export function resolveBlvdLocationName(
  blvdLocationName: string | null | undefined,
  bqLocationNames: string[]
): LocationResolution {
  if (!blvdLocationName || bqLocationNames.length === 0) return UNMATCHED

  const candidates = bqLocationNames.map((n) => ({ id: n, name: n }))
  const best = suggestLocationMatch(blvdLocationName, candidates)
  if (!best) return UNMATCHED

  // Identical normalized token sets => exact (Jaccard 1.0).
  if (normalizeName(blvdLocationName) === normalizeName(best.name)) {
    return {
      resolvedBqLocationName: best.name,
      method: "name_exact",
      confidence: "high",
    }
  }

  return {
    resolvedBqLocationName: best.name,
    method: "name_fuzzy",
    confidence: best.confidence >= FUZZY_MEDIUM_MIN ? "medium" : "low",
  }
}
