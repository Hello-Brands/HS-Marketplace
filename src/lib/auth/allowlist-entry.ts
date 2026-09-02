/**
 * Parsing and shaping of admin allowlist entries.
 *
 * The allowlist table has a single `email` column (unique, not null) and no
 * schema change is wanted here, so a whole-company entry is stored in that
 * same column with a leading "@": `@partnerbrand.com`. `isDomainEntry` is the
 * only thing that tells the two kinds apart, which works because a real email
 * address can never start with "@".
 *
 * MATCHING IS EXACT-DOMAIN ONLY. `@partnerbrand.com` admits
 * `jane@partnerbrand.com` but NOT `jane@mail.partnerbrand.com`. A subdomain
 * wildcard would widen access silently: an admin who types the company's main
 * domain would, without noticing, also be admitting every current and future
 * subdomain — including ones the partner hands out to contractors, staging
 * hosts, or (where a provider owns the parent domain) unrelated tenants. If a
 * subdomain genuinely needs in, an admin adds `@mail.partnerbrand.com` as its
 * own entry, and that grant is visible in the allowlist UI.
 *
 * This module is pure: no db, no server-only imports, safe to import anywhere.
 */

export type AllowlistEntry =
  /** `value` is the normalized email address, e.g. `jane@partnerbrand.com`. */
  | { kind: "email"; value: string }
  /** `value` is the stored string INCLUDING the leading "@", e.g. `@partnerbrand.com`. */
  | { kind: "domain"; value: string }

export type ParseAllowlistEntryResult =
  | { ok: true; entry: AllowlistEntry }
  | { ok: false; error: string }

/**
 * A dotted domain of letter/digit/hyphen labels: at least one dot, and no
 * label may start or end with a hyphen. Deliberately excludes "@", so a
 * second "@" anywhere makes the whole input invalid rather than being
 * silently swallowed into the domain.
 */
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

/**
 * Turn whatever an admin typed into the exact string to store, or an error
 * message safe to show them.
 *
 * Errors are returned rather than thrown because the caller is a server
 * action: a thrown message gets redacted in production builds.
 */
export function parseAllowlistEntry(raw: string): ParseAllowlistEntryResult {
  const value = raw.trim().toLowerCase()

  if (!value) {
    return { ok: false, error: "Enter an email address or a domain starting with @" }
  }

  if (value.startsWith("@")) {
    const domain = value.slice(1)
    if (!DOMAIN_RE.test(domain)) {
      return { ok: false, error: "Domain entries look like @partnerbrand.com" }
    }
    return { ok: true, entry: { kind: "domain", value } }
  }

  if (value.includes("@")) {
    const parts = value.split("@")
    if (parts.length !== 2) {
      return { ok: false, error: "Enter a valid email address" }
    }
    const [local, domain] = parts
    if (!local || /[\s"']/.test(local) || !DOMAIN_RE.test(domain)) {
      return { ok: false, error: "Enter a valid email address" }
    }
    return { ok: true, entry: { kind: "email", value } }
  }

  // Something like "partnerbrand.com": almost certainly a company-wide grant
  // typed without the sigil. Say so instead of rejecting it as a bad email.
  return { ok: false, error: "To allow a whole company, start with @ (e.g. @partnerbrand.com)" }
}

/** True when a stored allowlist string is a whole-domain entry. */
export function isDomainEntry(stored: string): boolean {
  return stored.startsWith("@")
}

/**
 * The stored domain-entry string that would admit this address, or null when
 * the address has no domain part.
 *
 * Uses the part after the LAST "@", and returns it verbatim — so
 * `jane@mail.partner.com` yields `@mail.partner.com`, never `@partner.com`.
 * That is the exact-match rule in one line.
 */
export function domainEntryFor(normalizedEmail: string): string | null {
  const at = normalizedEmail.lastIndexOf("@")
  if (at === -1) return null
  const domain = normalizedEmail.slice(at + 1)
  return domain ? `@${domain}` : null
}
