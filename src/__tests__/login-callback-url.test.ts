import { describe, it, expect } from "vitest"
import { safeCallbackUrl } from "@/lib/auth/callback-url"

/**
 * /login previously ignored ?callbackUrl and always landed on /browse, which
 * would strand every MCP authorization mid-flow. It now honours the parameter —
 * but only for same-origin RELATIVE paths, so it never becomes an open redirect.
 */
describe("safeCallbackUrl", () => {
  it("returns the default when there is no callbackUrl", () => {
    expect(safeCallbackUrl(null)).toBe("/browse")
    expect(safeCallbackUrl(undefined)).toBe("/browse")
    expect(safeCallbackUrl("")).toBe("/browse")
  })

  it("keeps a relative path with its query string", () => {
    expect(safeCallbackUrl("/mcp/authorize?client_id=claude-hosted&state=abc")).toBe(
      "/mcp/authorize?client_id=claude-hosted&state=abc",
    )
  })

  it("rejects an absolute URL on another origin", () => {
    expect(safeCallbackUrl("https://evil.example/steal")).toBe("/browse")
  })

  it("rejects a protocol-relative URL", () => {
    // "//evil.example" is an absolute URL to a browser, not a path.
    expect(safeCallbackUrl("//evil.example/steal")).toBe("/browse")
  })

  it("rejects a backslash-smuggled origin", () => {
    // Some browsers normalise "/\" to "//".
    expect(safeCallbackUrl("/\\evil.example/steal")).toBe("/browse")
  })

  it("rejects a javascript: URL", () => {
    expect(safeCallbackUrl("javascript:alert(1)")).toBe("/browse")
  })

  it("rejects a value with a control character or newline", () => {
    expect(safeCallbackUrl("/browse\nLocation: https://evil.example")).toBe("/browse")
  })

  it("honours an explicit fallback", () => {
    expect(safeCallbackUrl(null, "/admin")).toBe("/admin")
  })
})
