/**
 * Display helpers for the monitored-brands list on the brand-requests hub.
 *
 * Pure string/array logic only — no DB, no React — so it can be unit tested
 * (vitest here is node-env and .ts-only, so components can't be render-tested).
 */

/**
 * Chip label for one monitored brand.
 *
 * `locationsCount` is null until the monitor's first scrape counts locations, so
 * the count is optional trim rather than part of the identity. A count of 0 is
 * treated the same as null on purpose: the monitor also writes 0 as its column
 * default, and "0 locations" reads as a broken scrape rather than as a fact.
 * Negative values can't happen but are handled the same way for safety.
 */
export function formatBrandChipLabel(
  name: string,
  locationsCount: number | null,
): string {
  const label = name.trim()
  if (locationsCount === null || !Number.isFinite(locationsCount) || locationsCount <= 0) {
    return label
  }
  return `${label} · ${locationsCount} location${locationsCount !== 1 ? "s" : ""}`
}

/**
 * Case-insensitive alphabetical sort. Non-mutating — the caller usually holds a
 * Drizzle result array it may reuse.
 */
export function sortMonitoredBrands<T extends { name: string }>(brands: T[]): T[] {
  return [...brands].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  )
}

/** Subtitle count for the section heading, e.g. "25 brands" / "1 brand". */
export function monitoredCountLabel(n: number): string {
  return `${n} brand${n !== 1 ? "s" : ""}`
}
