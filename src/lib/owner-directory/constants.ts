/**
 * Owner-directory constants shared by server modules AND standalone scripts.
 *
 * Deliberately free of `import "server-only"`: query.ts owns the BigQuery
 * directory query and is server-only, so a plain `tsx` script cannot import
 * anything from it (`server-only` resolves only through Next's bundler). The
 * backfill needs this literal without dragging BigQuery in, so it lives here
 * and query.ts re-exports it for existing callers.
 */

/** The literal owner_identifier used for closed/unmapped rows. Never linkable. */
export const UNKNOWN_OWNER = "Unknown Owner"
