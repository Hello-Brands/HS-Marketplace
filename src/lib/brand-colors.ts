// Canonical brand hex constants for contexts where CSS custom properties do
// NOT reliably resolve — Recharts/MapTiler SVG presentation
// attributes and inline HTML strings handed to those third-party libraries.
// This is the single source of truth for those cases; every value here must
// match the corresponding token in src/app/globals.css exactly. Only colors
// actually consumed by chart/map components are included — add more only as
// needed, and keep them in sync if the globals.css tokens ever change.
export const BRAND = {
  /** --hs-red-600 — brand primary crimson */
  crimson: '#ED1845',
  /** --hs-red-700 — primary-strong (hover/active) */
  crimsonStrong: '#C9143B',
  /** --hs-taupe / --gray-500 — secondary text, muted markers */
  taupe: '#8F7067',
  /** --hs-mauve — detected-date caption text */
  mauve: '#CBA499',
  /** --hs-blush / --hs-red-100 / --color-error-light */
  blush: '#F7DCDA',
  /** --color-warning / --color-amber-600 — caramel warning accent */
  warning: '#B9772E',
  /** --color-warning-light / --color-amber-100 */
  warningLight: '#F3E4D0',
  /** --color-error — danger status text */
  error: '#C0142F',
  /** --foreground / --gray-900 — brand ink */
  ink: '#1F1917',
  /** --gray-200 / --color-border — chart gridlines/axes */
  border: '#E8DED7',
} as const
