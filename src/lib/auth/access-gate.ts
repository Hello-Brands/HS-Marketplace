/**
 * The single access rule shared by every sign-in provider.
 *
 * Whether someone arrives via Google OAuth or an emailed magic link, the
 * question is identical: is this address on the Hello Sugar workspace domain,
 * or is it an external address an admin has explicitly allowlisted? Keeping
 * that decision here (pure, dependency-injected, no db/server-only imports)
 * means a new provider cannot accidentally ship a weaker gate — it just calls
 * `decideAccess`. The db lookup is passed in as `isAllowlisted` so this module
 * stays testable and importable from anywhere.
 */

export type AccessDecision = "workspace" | "allowlisted" | "denied"

export interface AccessGateDeps {
  workspaceDomain: string
  isAllowlisted: (normalizedEmail: string) => Promise<boolean>
}

/** Lowercase + trim. */
export function normalizeSignInEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * `workspace` if the email sits on the workspace domain, else `allowlisted` if
 * the allowlist lookup finds it, else `denied`.
 *
 * The domain test compares against `"@" + workspaceDomain` rather than the bare
 * domain, so a lookalike like `attacker@evilhellosugar.salon` does NOT match
 * `hellosugar.salon`. The allowlist lookup always receives the normalized
 * (lowercased) address, which is the form the admin allowlist action writes.
 */
export async function decideAccess(
  rawEmail: string,
  deps: AccessGateDeps,
): Promise<AccessDecision> {
  const email = normalizeSignInEmail(rawEmail)
  const suffix = `@${normalizeSignInEmail(deps.workspaceDomain)}`

  if (email.endsWith(suffix)) return "workspace"
  if (await deps.isAllowlisted(email)) return "allowlisted"
  return "denied"
}
