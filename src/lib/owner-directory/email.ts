/**
 * Canonical email form for matching: trimmed + lowercased. Returns null for
 * empty/blank input so callers never store or match on "".
 */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const e = email.trim().toLowerCase()
  return e.length > 0 ? e : null
}
