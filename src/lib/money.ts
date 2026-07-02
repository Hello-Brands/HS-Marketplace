/**
 * Shared money utilities. Listing money columns store integer **cents**; forms and
 * KPI values work in **dollars**. Keeping the conversion + formatting in one place
 * stops the ×100 drift that let DEBT-001 (admin edits storing dollars into cents
 * columns) hide across ~10 hand-rolled formatters.
 */

/** Whole-dollar (or fractional-dollar) amount → integer cents. */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/** Integer cents → dollars (may be fractional). */
export function centsToDollars(cents: number): number {
  return cents / 100
}

const USD_FULL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/**
 * Full currency form from cents, e.g. `12345600` → `"$123,456"`.
 * Rounds to whole dollars (no cents shown), matching every listing price display.
 */
export function formatUsdCents(cents: number): string {
  return USD_FULL.format(centsToDollars(cents))
}

/**
 * Compact currency form from cents for tight spaces (map pins, favorite cards):
 * `"$1.2M"` for ≥ $1M, `"$500k"` for ≥ $1,000, otherwise the plain dollar amount.
 * Mirrors the abbreviated style used in the browse map/favorites UI.
 */
export function formatUsdCentsCompact(cents: number): string {
  const dollars = centsToDollars(cents)
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}k`
  return `$${dollars.toLocaleString()}`
}
