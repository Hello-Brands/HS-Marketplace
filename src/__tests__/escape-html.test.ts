import { describe, it, expect } from "vitest"
import { escapeHtml } from "@/lib/escape-html"

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x" class='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    )
  })
  it("escapes ampersands first (no double-escaping)", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;")
  })
  it("leaves plain text untouched", () => {
    expect(escapeHtml("Austin Domain")).toBe("Austin Domain")
  })
})
