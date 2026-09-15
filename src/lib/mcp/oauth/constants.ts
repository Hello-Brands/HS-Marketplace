/**
 * Lifetimes and limits for the MCP OAuth server (spec §4.1, §4.3, §7.6).
 *
 * NOT a `"use server"` module. Kept dependency-free so both routes and tests
 * read the same numbers — a test that hard-codes "3600" drifts silently.
 */

/** Authorization code TTL. Short by design: it is exchanged immediately. */
export const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000

/** Access token TTL (spec §4.1: now + 1 h). */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000

/** Refresh token TTL (spec §4.1: now + 30 d). Extended on every rotation. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Minimum gap between `last_used_at` writes. Without it every MCP call becomes
 * a write; with it the column is accurate to the minute, which is all the
 * admin UI claims.
 */
export const LAST_USED_TOUCH_INTERVAL_MS = 60 * 1000

/** Consent-screen label cap (spec §4.2 step 4). */
export const CONSENT_LABEL_MAX_LENGTH = 60

/**
 * Token endpoint: 20 requests per minute per IP (spec §7.6).
 * Best-effort only — src/lib/rate-limit.ts is per-instance in-memory (DEBT-028).
 */
export const TOKEN_ENDPOINT_RATE_LIMIT = 20
export const TOKEN_ENDPOINT_RATE_WINDOW_MS = 60 * 1000
