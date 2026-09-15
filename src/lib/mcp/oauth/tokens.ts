/**
 * Pure OAuth primitives: token minting, hashing, PKCE verification and
 * redirect-URI matching.
 *
 * NOT a `"use server"` module and deliberately DB-free, so every branch is
 * unit-testable under this repo's node-env vitest (no component tests, `.ts`
 * glob only). Node `crypto` is used directly — `jose` is a dependency but
 * these are opaque tokens, not JWTs, so there is nothing to sign or parse.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * 32 bytes of CSPRNG entropy, base64url encoded (43 chars, no padding).
 * Used for authorization codes, access tokens and refresh tokens alike — only
 * the hash is ever stored, so one generator covers all three.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url")
}

/** SHA-256 hex digest — the at-rest form of every code and token. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

/**
 * RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))) === code_challenge.
 *
 * Compared with `timingSafeEqual` even though the challenge is not a secret:
 * the verifier is, and a length-aware early return plus byte-wise compare keeps
 * this from becoming an oracle if the two are ever swapped at a call site.
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false
  const computed = createHash("sha256").update(codeVerifier, "ascii").digest("base64url")
  const a = Buffer.from(computed, "utf8")
  const b = Buffer.from(codeChallenge, "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * Exact string match against the client's registered URIs, with one carve-out:
 * an `http` loopback URI matches on scheme + host + path + query while IGNORING
 * the port (RFC 8252 §7.3, echoed by the MCP client-registration spec). Claude
 * Code binds an ephemeral port it cannot register ahead of time.
 *
 * The carve-out is narrow on purpose: https loopback does not match an http
 * registration, a host that merely contains "localhost" is not loopback, and a
 * differing path or query fails like any other URI.
 */
export function redirectUriMatches(registered: string[], presented: string): boolean {
  if (registered.includes(presented)) return true

  let url: URL
  try {
    url = new URL(presented)
  } catch {
    return false
  }
  if (url.protocol !== "http:") return false
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false

  return registered.some((candidate) => {
    let reg: URL
    try {
      reg = new URL(candidate)
    } catch {
      return false
    }
    return (
      reg.protocol === url.protocol &&
      reg.hostname === url.hostname &&
      reg.pathname === url.pathname &&
      reg.search === url.search
    )
  })
}
