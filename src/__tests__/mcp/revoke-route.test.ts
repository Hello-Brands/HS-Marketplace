import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

/** Tests the REAL POST handler in src/app/mcp/revoke/route.ts. */

const { update } = vi.hoisted(() => ({ update: vi.fn() }))

vi.mock("@/db", () => ({ db: { update: (...args: unknown[]) => update(...args) } }))

vi.mock("@/lib/mcp/oauth/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mcp/oauth/tokens")>()
  return { ...actual, sha256Hex: vi.fn(actual.sha256Hex) }
})

import { POST } from "@/app/mcp/revoke/route"
import { sha256Hex } from "@/lib/mcp/oauth/tokens"

let updateBuilder: ChainedBuilder

function post(
  body: Record<string, string>,
  contentType: string | null = "application/x-www-form-urlencoded",
): Request {
  const headers: Record<string, string> = {}
  if (contentType !== null) headers["content-type"] = contentType
  return new Request("http://localhost/mcp/revoke", {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  updateBuilder = builder(undefined)
  update.mockReturnValue(updateBuilder)
})

describe("POST /mcp/revoke", () => {
  it("stamps revoked_at and returns 200 with no body", async () => {
    const res = await POST(post({ token: "an-access-token" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.text()).toBe("")
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({ revokedAt: expect.any(Date) })
  })

  it("returns 200 for a token that matches nothing (RFC 7009: no oracle)", async () => {
    updateBuilder = builder(undefined)
    update.mockReturnValue(updateBuilder)
    const res = await POST(post({ token: "never-issued" }))
    expect(res.status).toBe(200)
  })

  it("accepts a refresh token in the same parameter", async () => {
    // The handler hashes once and matches either column, so this is the same
    // code path — the assertion is that it does not 400 on a non-access token.
    const res = await POST(post({ token: "a-refresh-token", token_type_hint: "refresh_token" }))
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it("rejects a JSON body with 415 and writes nothing", async () => {
    const res = await POST(post({ token: "x" }, "application/json"))
    expect(res.status).toBe(415)
    expect((await res.json()).error).toBe("invalid_request")
    expect(update).not.toHaveBeenCalled()
  })

  it("rejects a missing token parameter with invalid_request", async () => {
    const res = await POST(post({}))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_request")
    expect(update).not.toHaveBeenCalled()
  })

  it("never echoes the presented token", async () => {
    const res = await POST(post({ token: "secret-token-value" }))
    expect(await res.text()).not.toContain("secret-token-value")
  })

  it("hashes the token rather than querying it in the clear", async () => {
    // Guards against a regression that compared the raw value: assert the
    // real hashing primitive was actually invoked with the presented token,
    // rather than re-deriving a digest the test never checks against anything.
    await POST(post({ token: "hash-me" }))
    expect(sha256Hex).toHaveBeenCalledWith("hash-me")
  })
})
