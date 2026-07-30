/**
 * Website-URL normalization for brand requests.
 *
 * PURE module on purpose — no `server-only`, no db, no env. The submit action
 * uses it server-side, and the normalized `domain` it produces is the dedupe key
 * shared with `monitored_brands.domain` (bare host, lowercase, no www — see that
 * schema file's header). Keeping it dependency-free means the same rules can be
 * reused from a client-side preview or a script without dragging the server
 * graph along.
 */

/** Matches a leading `scheme://` so we only prepend https when one is absent. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * Normalize a user-typed website into a canonical https URL plus its bare host.
 *
 * Returns null for anything we can't turn into a plausible web address — the
 * caller surfaces a single friendly message rather than distinguishing causes.
 *
 * Rules: scheme-less input gets `https://`; the protocol is always forced to
 * https (an http site that only serves plaintext still redirects in practice);
 * the host is lowercased. `domain` additionally drops a single leading `www.`
 * so `www.x.com` and `x.com` dedupe to the same brand — but `url` keeps the
 * host the user typed, because some sites only resolve on `www.` and `url` is
 * what the reachability probe hits and what gets stored. The host must look
 * like a real domain (contains a dot, no whitespace). Path and query survive,
 * any trailing slash does not, so a bare origin normalizes to `https://host`
 * with no slash. A fragment is dropped — it never identifies a different page
 * server-side.
 */
export function normalizeWebsiteUrl(
  raw: string,
): { url: string; domain: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  // One leading `www.` only — `www.www.x.com` keeps the inner label.
  const domain = host.replace(/^www\./, "")
  if (!domain.includes(".")) return null
  if (/\s/.test(domain)) return null
  // A brand website is never an IP literal or a local name — and the submit
  // action HEAD-probes this URL from the server, so refusing them here also
  // keeps that probe from being aimed at internal/loopback addresses.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) return null
  if (domain.includes(":") || domain.includes("[")) return null // IPv6 forms
  if (domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".local")) {
    return null
  }

  const hostWithPort = parsed.port ? `${host}:${parsed.port}` : host
  // "/" -> "", "/foo/" -> "/foo". Applied before the query so
  // `https://x.com/foo/?a=1` keeps its params.
  const pathname = parsed.pathname.replace(/\/+$/, "")

  return { url: `https://${hostWithPort}${pathname}${parsed.search}`, domain }
}

/**
 * Hosts that are a social/review presence rather than a brand's own site.
 * Requesting one would point the monitor's scraper at a platform, not a brand.
 */
export const BLOCKED_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "yelp.com",
  "google.com",
] as const

/**
 * True when `domain` IS a blocked domain or a subdomain of one.
 * `m.facebook.com` matches; `notfacebook.com` does not (the dot matters).
 */
export function isBlockedDomain(domain: string): boolean {
  const host = domain.toLowerCase()
  return BLOCKED_DOMAINS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  )
}
