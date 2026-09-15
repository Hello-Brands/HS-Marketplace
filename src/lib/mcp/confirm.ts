// Two-step confirmation for destructive MCP tools.
//
// NOT a use server module. Every "use server" export is a public POST endpoint;
// these are plain functions imported by the MCP tool modules, which are reached
// only through the bearer-verified POST /api/mcp route handler.
//
// Deliberately NOT marked `import "server-only"`: tsx scripts crash on any
// transitive server-only import and vitest stubs it, so the guard would buy
// nothing here and could break a future script.
//
// Why a token and not elicitation: Claude.ai web does not support elicitation, so
// the confirm step has to live in the tool contract itself. A destructive tool
// called WITHOUT `confirmation_token` runs its pre-checks, changes nothing, and
// returns a human preview plus a token. The same tool called WITH that token
// executes — but only if the tool name, the arguments and the acting admin are
// byte-identical to what was previewed, and only within CONFIRMATION_TTL_SECONDS.
//
// Stateless on purpose: there is no table and no cache, so this works unchanged
// across Vercel instances and cold starts. The integrity guarantee is the HMAC.
import { createHmac, timingSafeEqual } from "node:crypto"
import { env } from "@/lib/env"

/** How long a preview stays executable. Mirrored in the tool's `expires_in`. */
export const CONFIRMATION_TTL_SECONDS = 600

/**
 * Deterministic JSON: object keys sorted recursively, array ORDER preserved,
 * `undefined` dropped.
 *
 * This is what makes the signature argument-order-independent. `{reason, id}` and
 * `{id, reason}` are the same call, and a client that re-serialises the arguments
 * between the preview and the execute call must still be able to use its token.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

// Only JSON scalars, arrays and plain objects are supported — a non-plain object
// (Date, Map, class instance) is walked as a bag of own enumerable keys, so callers
// must sign JSON-shaped values only. MCP tool arguments always are.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>
    // Null-prototype: a key literally named `__proto__` (JSON.parse creates it as an
    // own property, which is exactly how MCP arguments arrive) would otherwise hit the
    // prototype setter, never become an own key, and silently vanish from the signature.
    const out = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue
      out[key] = canonicalize(source[key])
    }
    return out
  }
  return value
}

interface ConfirmationPayload {
  tool: string
  args: unknown
  userId: string
  /** Unix seconds. */
  exp: number
}

function sign(body: string): string {
  return createHmac("sha256", env.MCP_CONFIRM_SECRET).update(body).digest("hex")
}

/** `base64url(canonicalJson(payload))` + "." + `hex(HMAC-SHA256(body))`. */
export function createConfirmationToken(input: {
  tool: string
  args: unknown
  userId: string
}): string {
  const payload: ConfirmationPayload = {
    tool: input.tool,
    args: input.args,
    userId: input.userId,
    exp: Math.floor(Date.now() / 1000) + CONFIRMATION_TTL_SECONDS,
  }
  const body = Buffer.from(canonicalJson(payload), "utf8").toString("base64url")
  return `${body}.${sign(body)}`
}

export function verifyConfirmationToken(
  token: string,
  expected: { tool: string; args: unknown; userId: string },
): { ok: true } | { ok: false; reason: "expired" | "mismatch" | "malformed" } {
  const parts = token.split(".")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" }
  const [body, providedSig] = parts

  // Shape-check the signature before anything else: timingSafeEqual compares BYTES and
  // throws a RangeError on a length difference, and a JS string's .length is UTF-16 code
  // units, not bytes ("é".repeat(64) is 64 long but 128 bytes). Anything that is not
  // exactly our digest — 64 lowercase hex chars — is a garbled token, not a wrong one.
  if (!/^[0-9a-f]{64}$/.test(providedSig)) return { ok: false, reason: "malformed" }

  // Signature first: never parse attacker-controlled bytes we have not authenticated.
  // Both buffers are now guaranteed to be 64 ASCII bytes, so timingSafeEqual cannot throw.
  const expectedSig = sign(body)
  if (!timingSafeEqual(Buffer.from(providedSig, "utf8"), Buffer.from(expectedSig, "utf8"))) {
    return { ok: false, reason: "mismatch" }
  }

  let payload: ConfirmationPayload
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as ConfirmationPayload).tool !== "string" ||
      typeof (parsed as ConfirmationPayload).userId !== "string" ||
      typeof (parsed as ConfirmationPayload).exp !== "number"
    ) {
      return { ok: false, reason: "malformed" }
    }
    payload = parsed as ConfirmationPayload
  } catch {
    return { ok: false, reason: "malformed" }
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" }

  // Compare the whole authorised triple in one canonical string — cheaper to read
  // than three comparisons and impossible to forget a field when one is added.
  const signed = canonicalJson({ tool: payload.tool, args: payload.args, userId: payload.userId })
  const asked = canonicalJson({ tool: expected.tool, args: expected.args, userId: expected.userId })
  if (signed !== asked) return { ok: false, reason: "mismatch" }

  return { ok: true }
}

/** What a destructive tool returns when it has changed nothing and wants a confirm. */
export interface ConfirmationPrompt {
  preview: string
  confirmation_token: string
  expires_in: number
}

const RETRY = (tool: string) =>
  `Call ${tool} again without confirmation_token to get a fresh preview.`

/**
 * The single entry point every destructive tool uses.
 *
 * - No token  -> returns a ConfirmationPrompt. The tool returns it verbatim and
 *                makes NO changes.
 * - Good token -> returns null. The tool proceeds.
 * - Bad token  -> throws a plain Error, which `writeTool` surfaces as an
 *                `isError` result carrying the message verbatim.
 *
 * `args` MUST already have `confirmation_token` stripped — it is not part of what
 * is signed, or the token could never match the call that carries it.
 */
export function requireConfirmation(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  token: string | undefined,
  preview: string,
): ConfirmationPrompt | null {
  // Stripped defensively as well as by contract: if a caller ever passed the raw
  // arguments through, the token would sign a field that only exists on the second
  // call and could therefore never match it.
  const signed = { ...args }
  delete signed.confirmation_token

  if (!token) {
    return {
      preview,
      confirmation_token: createConfirmationToken({ tool, args: signed, userId }),
      expires_in: CONFIRMATION_TTL_SECONDS,
    }
  }

  const verdict = verifyConfirmationToken(token, { tool, args: signed, userId })
  if (verdict.ok) return null

  switch (verdict.reason) {
    case "expired":
      throw new Error(`Confirmation token expired. ${RETRY(tool)}`)
    case "malformed":
      throw new Error(`Confirmation token is malformed. ${RETRY(tool)}`)
    default:
      throw new Error(`Confirmation token does not match these arguments. ${RETRY(tool)}`)
  }
}
