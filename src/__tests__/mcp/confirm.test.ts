import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createHmac } from "node:crypto"

vi.mock("server-only", () => ({}))

import {
  CONFIRMATION_TTL_SECONDS,
  canonicalJson,
  createConfirmationToken,
  verifyConfirmationToken,
  requireConfirmation,
} from "@/lib/mcp/confirm"

// env is a live process.env proxy under SKIP_ENV_VALIDATION (see src/lib/env.ts),
// so stubbing the raw variable is enough and needs no module reset.
beforeEach(() => {
  vi.stubEnv("MCP_CONFIRM_SECRET", "test-secret-at-least-32-characters-long")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("canonicalJson", () => {
  it("orders object keys so argument order cannot change the signature", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it("orders keys recursively, including inside arrays", () => {
    expect(canonicalJson({ x: [{ z: 1, y: 2 }] })).toBe('{"x":[{"y":2,"z":1}]}')
  })

  it("preserves array ORDER — order is meaningful in a patch", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]))
  })

  it("drops undefined values so an explicitly-undefined key matches an absent one", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it("keeps a literal __proto__ key, so it cannot be swapped without changing the signature", () => {
    // Own `__proto__` properties only exist via JSON.parse (an object literal's
    // `__proto__:` sets the prototype instead) — which is exactly how MCP args arrive.
    const a: unknown = JSON.parse('{"__proto__":{"x":1},"b":2}')
    const b: unknown = JSON.parse('{"__proto__":{"x":9},"b":2}')
    expect(canonicalJson(a)).not.toBe(canonicalJson(b))
    expect(canonicalJson(a)).toBe('{"__proto__":{"x":1},"b":2}')
  })

  it("serialises null, numbers, booleans and strings as JSON does", () => {
    expect(canonicalJson({ a: null, b: 1.5, c: true, d: "x" })).toBe(
      '{"a":null,"b":1.5,"c":true,"d":"x"}',
    )
  })
})

describe("confirmation tokens", () => {
  const input = {
    tool: "reject_listing",
    args: { listing_id: "l1", reason: "Duplicate" },
    userId: "u-1",
  }

  it("round-trips: a freshly minted token verifies", () => {
    const token = createConfirmationToken(input)
    expect(verifyConfirmationToken(token, input)).toEqual({ ok: true })
  })

  it("is shaped base64url-payload.hex-signature", () => {
    const [body, sig] = createConfirmationToken(input).split(".")
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it("rejects a token minted for different arguments", () => {
    const token = createConfirmationToken(input)
    expect(
      verifyConfirmationToken(token, { ...input, args: { listing_id: "l2", reason: "Duplicate" } }),
    ).toEqual({ ok: false, reason: "mismatch" })
  })

  it("accepts the same arguments written in a different key order", () => {
    const token = createConfirmationToken(input)
    expect(
      verifyConfirmationToken(token, {
        ...input,
        args: { reason: "Duplicate", listing_id: "l1" },
      }),
    ).toEqual({ ok: true })
  })

  it("rejects a token minted for a different tool", () => {
    const token = createConfirmationToken(input)
    expect(verifyConfirmationToken(token, { ...input, tool: "mark_listing_sold" })).toEqual({
      ok: false,
      reason: "mismatch",
    })
  })

  it("rejects another admin replaying the token", () => {
    const token = createConfirmationToken(input)
    expect(verifyConfirmationToken(token, { ...input, userId: "u-2" })).toEqual({
      ok: false,
      reason: "mismatch",
    })
  })

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = createConfirmationToken(input)
    const [body, sig] = token.split(".")
    const forged = Buffer.from(
      JSON.stringify({
        tool: "reject_listing",
        args: { listing_id: "l2" },
        userId: "u-1",
        exp: 9e9,
      }),
    ).toString("base64url")
    expect(verifyConfirmationToken(`${forged}.${sig}`, input)).toEqual({
      ok: false,
      reason: "mismatch",
    })
    expect(body).not.toBe(forged)
  })

  it("rejects a token signed with a different secret", () => {
    const token = createConfirmationToken(input)
    vi.stubEnv("MCP_CONFIRM_SECRET", "a-completely-different-secret-32-chars")
    expect(verifyConfirmationToken(token, input)).toEqual({ ok: false, reason: "mismatch" })
  })

  it("expires exactly 600 seconds after minting", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"))
    const token = createConfirmationToken(input)

    vi.setSystemTime(new Date("2026-09-14T12:09:59.000Z"))
    expect(verifyConfirmationToken(token, input)).toEqual({ ok: true })

    vi.setSystemTime(new Date("2026-09-14T12:10:01.000Z"))
    expect(verifyConfirmationToken(token, input)).toEqual({ ok: false, reason: "expired" })
    expect(CONFIRMATION_TTL_SECONDS).toBe(600)
  })

  it("reports a structurally broken token as malformed, not as a crash", () => {
    const body = createConfirmationToken(input).split(".")[0]
    const bad = [
      "",
      "nodot",
      "a.b.c",
      "!!!.aaaa",
      // Non-ASCII signature: 64 UTF-16 units but 128 bytes — timingSafeEqual would
      // throw a RangeError, which the route's error map would report as an
      // "Unexpected error" instead of a bad token.
      `${body}.${"é".repeat(64)}`,
      // Right alphabet, wrong length.
      `${body}.${"a".repeat(63)}`,
      `${body}.${"a".repeat(65)}`,
      // Uppercase hex is not what we emit.
      `${body}.${"A".repeat(64)}`,
    ]
    for (const token of bad) {
      expect(() => verifyConfirmationToken(token, input)).not.toThrow()
      expect(verifyConfirmationToken(token, input)).toEqual({ ok: false, reason: "malformed" })
    }
  })

  it("reports a correctly-signed but non-JSON payload as malformed", () => {
    // Sign arbitrary bytes with the real secret so the signature check passes.
    const body = Buffer.from("not json at all").toString("base64url")
    const sig = createHmac("sha256", "test-secret-at-least-32-characters-long")
      .update(body)
      .digest("hex")
    expect(verifyConfirmationToken(`${body}.${sig}`, input)).toEqual({
      ok: false,
      reason: "malformed",
    })
  })
})

describe("requireConfirmation", () => {
  const args = { listing_id: "l1", reason: "Duplicate" }

  it("returns a preview and a usable token when none was supplied", () => {
    const prompt = requireConfirmation(
      "u-1",
      "reject_listing",
      args,
      undefined,
      'Reject listing "Aspen".',
    )
    expect(prompt).not.toBeNull()
    expect(prompt!.preview).toBe('Reject listing "Aspen".')
    expect(prompt!.expires_in).toBe(600)
    expect(
      verifyConfirmationToken(prompt!.confirmation_token, {
        tool: "reject_listing",
        args,
        userId: "u-1",
      }),
    ).toEqual({ ok: true })
  })

  it("ignores a confirmation_token key inside args when signing", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"))
    const clean = requireConfirmation("u-1", "reject_listing", args, undefined, "preview")!
    const withToken = requireConfirmation(
      "u-1",
      "reject_listing",
      { ...args, confirmation_token: "stale" },
      undefined,
      "preview",
    )!
    expect(withToken.confirmation_token).toBe(clean.confirmation_token)
    // And the round trip still works when the execute call carries the token in args.
    expect(
      requireConfirmation(
        "u-1",
        "reject_listing",
        { ...args, confirmation_token: clean.confirmation_token },
        clean.confirmation_token,
        "preview",
      ),
    ).toBeNull()
  })

  it("returns null — proceed — for a matching token", () => {
    const prompt = requireConfirmation("u-1", "reject_listing", args, undefined, "preview")!
    expect(
      requireConfirmation("u-1", "reject_listing", args, prompt.confirmation_token, "preview"),
    ).toBeNull()
  })

  it("throws an actionable message when the arguments changed", () => {
    const prompt = requireConfirmation("u-1", "reject_listing", args, undefined, "preview")!
    expect(() =>
      requireConfirmation(
        "u-1",
        "reject_listing",
        { ...args, reason: "Something else" },
        prompt.confirmation_token,
        "preview",
      ),
    ).toThrow(
      "Confirmation token does not match these arguments. Call reject_listing again without confirmation_token to get a fresh preview.",
    )
  })

  it("throws a plain Error so writeTool surfaces the message verbatim", () => {
    try {
      requireConfirmation("u-1", "reject_listing", args, "garbage", "preview")
      throw new Error("should have thrown")
    } catch (err) {
      expect((err as Error).name).toBe("Error")
      expect((err as Error).message).toMatch(/^Confirmation token is malformed\./)
    }
  })

  it("throws an expiry-specific message once the token is stale", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-14T12:00:00.000Z"))
    const prompt = requireConfirmation("u-1", "reject_listing", args, undefined, "preview")!
    vi.setSystemTime(new Date("2026-09-14T12:20:00.000Z"))
    expect(() =>
      requireConfirmation("u-1", "reject_listing", args, prompt.confirmation_token, "preview"),
    ).toThrow(/^Confirmation token expired\./)
  })
})
