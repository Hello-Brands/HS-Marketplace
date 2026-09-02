import { describe, it, expect } from "vitest"
import {
  parseAllowlistEntry,
  isDomainEntry,
  domainEntryFor,
} from "@/lib/auth/allowlist-entry"

describe("parseAllowlistEntry — email entries", () => {
  it("accepts an email, normalized", () => {
    expect(parseAllowlistEntry("  Jane.Doe@Partner.COM \n")).toEqual({
      ok: true,
      entry: { kind: "email", value: "jane.doe@partner.com" },
    })
  })

  it("rejects two @ signs", () => {
    expect(parseAllowlistEntry("a@b@c.com")).toEqual({
      ok: false,
      error: "Enter a valid email address",
    })
  })

  it("rejects a quoted local part", () => {
    expect(parseAllowlistEntry('"quoted"@x.com')).toEqual({
      ok: false,
      error: "Enter a valid email address",
    })
  })

  it("rejects an empty local part", () => {
    // Not a domain entry: "@x.com" starts with @, so it parses as a domain.
    // This is the whitespace-separated near-miss instead.
    expect(parseAllowlistEntry("jane doe@x.com")).toEqual({
      ok: false,
      error: "Enter a valid email address",
    })
  })

  it("rejects an email whose domain has no dot", () => {
    expect(parseAllowlistEntry("jane@localhost")).toEqual({
      ok: false,
      error: "Enter a valid email address",
    })
  })
})

describe("parseAllowlistEntry — domain entries", () => {
  it("accepts a domain, normalized, keeping the leading @", () => {
    expect(parseAllowlistEntry("@Partner.COM ")).toEqual({
      ok: true,
      entry: { kind: "domain", value: "@partner.com" },
    })
  })

  it("accepts an explicit subdomain as its own entry", () => {
    expect(parseAllowlistEntry("@mail.partner.com")).toEqual({
      ok: true,
      entry: { kind: "domain", value: "@mail.partner.com" },
    })
  })

  it.each(["@", "@-bad.com", "@bad", "@a@b.com", "@bad-.com", "@.com"])(
    "rejects %j with the domain error",
    (input) => {
      expect(parseAllowlistEntry(input)).toEqual({
        ok: false,
        error: "Domain entries look like @partnerbrand.com",
      })
    },
  )
})

describe("parseAllowlistEntry — no @ at all", () => {
  it("nudges a bare domain toward the @ form", () => {
    expect(parseAllowlistEntry("partner.com")).toEqual({
      ok: false,
      error: "To allow a whole company, start with @ (e.g. @partnerbrand.com)",
    })
  })

  it("rejects empty input", () => {
    expect(parseAllowlistEntry("   ")).toEqual({
      ok: false,
      error: "Enter an email address or a domain starting with @",
    })
    expect(parseAllowlistEntry("")).toEqual({
      ok: false,
      error: "Enter an email address or a domain starting with @",
    })
  })
})

describe("isDomainEntry", () => {
  it("splits the two stored kinds on the leading @", () => {
    expect(isDomainEntry("@partner.com")).toBe(true)
    expect(isDomainEntry("jane@partner.com")).toBe(false)
    expect(isDomainEntry("")).toBe(false)
  })
})

describe("domainEntryFor", () => {
  it("returns the exact domain with a leading @", () => {
    expect(domainEntryFor("jane@partner.com")).toBe("@partner.com")
  })

  it("keeps the subdomain, which is why a subdomain address will NOT match @partner.com", () => {
    expect(domainEntryFor("jane@mail.partner.com")).toBe("@mail.partner.com")
  })

  it("uses the part after the LAST @", () => {
    expect(domainEntryFor("weird@thing@partner.com")).toBe("@partner.com")
  })

  it("returns null without a domain", () => {
    expect(domainEntryFor("nodomain")).toBeNull()
    expect(domainEntryFor("jane@")).toBeNull()
  })
})
