import type { Alert } from "@/db/schema/alerts"

export type SavedSearchFields = Pick<
  Alert,
  | "query" | "states" | "listingTypes" | "minPrice" | "maxPrice"
  | "minYearsOpen" | "inventoryIncluded" | "sort" | "centerLat" | "centerLng" | "radiusMiles" | "centerLabel"
>

const TYPE_LABELS: Record<string, string> = {
  suite: "Suite", flagship: "Flagship", territory: "Territory", bundle: "Bundle",
}

function fmtShortPrice(cents: number): string {
  const d = cents / 100
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`
  if (d >= 1_000) return `$${Math.round(d / 1_000)}k`
  return `$${d}`
}

function priceLabel(minCents: number | null, maxCents: number | null): string | null {
  if (minCents != null && maxCents != null) return `${fmtShortPrice(minCents)}–${fmtShortPrice(maxCents)}`
  if (minCents != null) return `${fmtShortPrice(minCents)}+`
  if (maxCents != null) return `≤${fmtShortPrice(maxCents)}`
  return null
}

/** Human one-line summary of a saved search. */
export function describeSavedSearch(a: SavedSearchFields): string {
  const parts: string[] = []

  if (a.listingTypes && a.listingTypes.length > 0) {
    parts.push(a.listingTypes.map((t) => TYPE_LABELS[t] ?? t).join(", "))
  }
  if (a.states && a.states.length > 0) {
    parts.push(a.states.length <= 2 ? a.states.join(", ") : `${a.states.length} states`)
  }
  const price = priceLabel(a.minPrice ?? null, a.maxPrice ?? null)
  if (price) parts.push(price)
  if (a.minYearsOpen && a.minYearsOpen > 0) parts.push(`${a.minYearsOpen}+ yrs open`)
  if (a.inventoryIncluded) parts.push("inventory included")
  if (a.centerLat != null && a.centerLng != null && a.radiusMiles != null) {
    parts.push(`within ${a.radiusMiles} mi of ${a.centerLabel || "selected location"}`)
  }
  if (a.query && a.query.trim()) parts.push(`"${a.query.trim()}"`)

  return parts.length > 0 ? parts.join(" · ") : "All listings"
}

/** Build a `/browse` query string (no leading `?`) from a saved search. */
export function savedSearchToBrowseParams(a: SavedSearchFields): string {
  const p = new URLSearchParams()
  if (a.query && a.query.trim()) p.set("query", a.query.trim())
  if (a.listingTypes && a.listingTypes.length > 0) p.set("types", a.listingTypes.join(","))
  if (a.states && a.states.length > 0) p.set("states", a.states.join(","))
  if (a.minPrice != null) p.set("minPrice", String(a.minPrice))
  if (a.maxPrice != null) p.set("maxPrice", String(a.maxPrice))
  if (a.minYearsOpen != null) p.set("minYearsOpen", String(a.minYearsOpen))
  if (a.inventoryIncluded) p.set("inventoryIncluded", "true")
  if (a.sort) p.set("sort", a.sort)
  if (a.centerLat != null) p.set("centerLat", String(a.centerLat))
  if (a.centerLng != null) p.set("centerLng", String(a.centerLng))
  if (a.radiusMiles != null) p.set("radiusMiles", String(a.radiusMiles))
  if (a.centerLabel) p.set("centerLabel", a.centerLabel)
  return p.toString()
}
