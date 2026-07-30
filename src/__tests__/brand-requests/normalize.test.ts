import { describe, it, expect } from "vitest"
import {
  BLOCKED_DOMAINS,
  isBlockedDomain,
  normalizeWebsiteUrl,
} from "@/lib/brand-requests/normalize"

describe("normalizeWebsiteUrl", () => {
  it("prepends https to a scheme-less host", () => {
    expect(normalizeWebsiteUrl("brandname.com")).toEqual({
      url: "https://brandname.com",
      domain: "brandname.com",
    })
  })

  it("upgrades http to https", () => {
    expect(normalizeWebsiteUrl("http://brandname.com")).toEqual({
      url: "https://brandname.com",
      domain: "brandname.com",
    })
  })

  it("strips a single leading www. from the domain but keeps it in the url", () => {
    expect(normalizeWebsiteUrl("https://www.brandname.com")).toEqual({
      url: "https://www.brandname.com",
      domain: "brandname.com",
    })
  })

  it("keeps inner labels when stripping www. from the domain", () => {
    expect(normalizeWebsiteUrl("https://www.shop.brandname.com")).toEqual({
      url: "https://www.shop.brandname.com",
      domain: "shop.brandname.com",
    })
  })

  it("lowercases the host", () => {
    expect(normalizeWebsiteUrl("HTTPS://WWW.BrandName.COM")).toEqual({
      url: "https://www.brandname.com",
      domain: "brandname.com",
    })
  })

  it("strips a trailing slash from a bare origin", () => {
    expect(normalizeWebsiteUrl("https://brandname.com/")?.url).toBe(
      "https://brandname.com",
    )
  })

  it("strips a trailing slash from a path", () => {
    expect(normalizeWebsiteUrl("brandname.com/locations/")?.url).toBe(
      "https://brandname.com/locations",
    )
  })

  it("preserves path and query", () => {
    expect(normalizeWebsiteUrl("brandname.com/locations/?state=tx")).toEqual({
      url: "https://brandname.com/locations?state=tx",
      domain: "brandname.com",
    })
  })

  it("trims surrounding whitespace", () => {
    expect(normalizeWebsiteUrl("   brandname.com   ")?.domain).toBe("brandname.com")
  })

  it("returns null for empty input", () => {
    expect(normalizeWebsiteUrl("")).toBeNull()
    expect(normalizeWebsiteUrl("   ")).toBeNull()
  })

  it("returns null for a host with no dot", () => {
    expect(normalizeWebsiteUrl("brandname")).toBeNull()
    expect(normalizeWebsiteUrl("https://localhost")).toBeNull()
  })

  it("returns null for unparseable input", () => {
    expect(normalizeWebsiteUrl("https://")).toBeNull()
    expect(normalizeWebsiteUrl("not a url at all")).toBeNull()
    expect(normalizeWebsiteUrl("javascript:alert(1)")).toBeNull()
  })

  it("returns null for a file URL with no host", () => {
    expect(normalizeWebsiteUrl("file:///etc/passwd")).toBeNull()
  })

  it("returns null for IP literals and local names (server-side probe targets)", () => {
    expect(normalizeWebsiteUrl("https://192.168.1.1")).toBeNull()
    expect(normalizeWebsiteUrl("http://169.254.169.254/latest/meta-data")).toBeNull()
    expect(normalizeWebsiteUrl("10.0.0.5:8080")).toBeNull()
    expect(normalizeWebsiteUrl("https://[::1]")).toBeNull()
    expect(normalizeWebsiteUrl("https://foo.localhost")).toBeNull()
    expect(normalizeWebsiteUrl("https://printer.local")).toBeNull()
  })
})

describe("isBlockedDomain", () => {
  it("matches every blocked domain exactly", () => {
    for (const domain of BLOCKED_DOMAINS) {
      expect(isBlockedDomain(domain)).toBe(true)
    }
  })

  it("matches subdomains of a blocked domain", () => {
    expect(isBlockedDomain("m.facebook.com")).toBe(true)
    expect(isBlockedDomain("business.facebook.com")).toBe(true)
    expect(isBlockedDomain("biz.yelp.com")).toBe(true)
  })

  it("is case-insensitive", () => {
    expect(isBlockedDomain("M.Facebook.COM")).toBe(true)
  })

  it("does not match a lookalike suffix", () => {
    expect(isBlockedDomain("notfacebook.com")).toBe(false)
    expect(isBlockedDomain("myyelp.com")).toBe(false)
  })

  it("allows an ordinary brand domain", () => {
    expect(isBlockedDomain("waxcenter.com")).toBe(false)
  })

  it("does not match a blocked name in the path-like position", () => {
    // Only the bare domain is ever passed in, but be explicit about the rule.
    expect(isBlockedDomain("brandname.com")).toBe(false)
  })
})
