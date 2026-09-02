/**
 * The single access rule shared by every sign-in provider.
 *
 * Whether someone arrives via Google OAuth or an emailed magic link, the
 * question is identical: is this address on the Hello Sugar workspace domain,
 * or is it something an admin has explicitly allowlisted? The allowlist holds
 * two kinds of entry (see src/lib/auth/allowlist-entry.ts): an individual
 * address, or a whole-company entry stored as `@partnerbrand.com`. Domain
 * entries match EXACTLY — `@partnerbrand.com` admits `jane@partnerbrand.com`
 * but not `jane@mail.partnerbrand.com`, so an admin never widens access to
 * subdomains they did not name.
 *
 * Keeping that decision here (pure, dependency-injected, no db/server-only
 * imports) means a new provider cannot accidentally ship a weaker gate — it
 * just calls `decideAccess`. The db lookup is passed in as `isAllowlisted` so
 * this module stays testable and importable from anywhere.
 */

import { domainEntryFor } from "./allowlist-entry"

export type AccessDecision = "workspace" | "allowlisted" | "denied"

export interface AccessGateDeps {
  workspaceDomain: string
  /**
   * Receives every stored allowlist string that would admit this address: the
   * normalized email itself and its `@domain` entry. Return true if ANY of
   * them exists. One db query.
   */
  isAllowlisted: (candidates: string[]) => Promise<boolean>
}

/** Lowercase + trim. */
export function normalizeSignInEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * The stored allowlist strings that would admit `normalizedEmail`: the address
 * itself, plus its exact `@domain` entry when it has one.
 */
export function allowlistCandidates(normalizedEmail: string): string[] {
  const domain = domainEntryFor(normalizedEmail)
  return domain ? [normalizedEmail, domain] : [normalizedEmail]
}

/**
 * `workspace` if the email sits on the workspace domain, else `allowlisted` if
 * the allowlist lookup finds the address or its exact domain, else `denied`.
 *
 * The domain test compares against `"@" + workspaceDomain` rather than the bare
 * domain, so a lookalike like `attacker@evilhellosugar.salon` does NOT match
 * `hellosugar.salon`. The allowlist lookup always receives normalized
 * (lowercased) candidates, which is the form the admin allowlist action writes.
 */
export async function decideAccess(
  rawEmail: string,
  deps: AccessGateDeps,
): Promise<AccessDecision> {
  const email = normalizeSignInEmail(rawEmail)
  const suffix = `@${normalizeSignInEmail(deps.workspaceDomain)}`

  if (email.endsWith(suffix)) return "workspace"
  if (await deps.isAllowlisted(allowlistCandidates(email))) return "allowlisted"
  return "denied"
}
