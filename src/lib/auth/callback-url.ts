/**
 * Post-sign-in redirect target, sanitised.
 *
 * NOT a `"use server"` module. Deliberately dependency-free so it can be used
 * from the login page and from tests without pulling in Auth.js.
 *
 * Only a same-origin RELATIVE path is ever returned. Anything absolute,
 * protocol-relative, backslash-smuggled, scheme-bearing, or containing a
 * control character falls back -- `signIn(..., { redirectTo })` would otherwise
 * hand an attacker a one-click open redirect off an authenticated session.
 */
export function safeCallbackUrl(
  raw: string | null | undefined,
  fallback = "/browse",
): string {
  if (!raw) return fallback
  // Control characters (incl. CR/LF header smuggling) disqualify outright.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback
  if (!raw.startsWith("/")) return fallback
  // "//host" and "/\host" are absolute URLs to a browser, not paths.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback
  return raw
}
