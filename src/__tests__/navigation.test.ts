import { describe, it, expect } from "vitest"
import {
  deriveCapabilities,
  visibleNavItems,
  visiblePrimaryAction,
  isActive,
  MARKETPLACE_NAV,
  type NavItem,
} from "@/lib/navigation"
import { tabLabel } from "@/components/layout/MobileTabBar"

describe("deriveCapabilities", () => {
  it("treats role=admin as admin AND seller", () => {
    const caps = deriveCapabilities({ role: "admin" })
    expect(caps).toEqual({ isAdmin: true, hasSeller: true, isOwner: false })
  })
  it("grants seller via sellerAccess without admin", () => {
    const caps = deriveCapabilities({ role: "user", sellerAccess: true })
    expect(caps).toEqual({ isAdmin: false, hasSeller: true, isOwner: false })
  })
  it("marks owner when any owner link is present", () => {
    const caps = deriveCapabilities({ role: "user", ownerIdentifiers: ["OWN-1"] })
    expect(caps.isOwner).toBe(true)
  })
  it("marks owner for a multi-profile owner", () => {
    const caps = deriveCapabilities({
      role: "user",
      ownerIdentifiers: ["ut-lines-towns", "ut-towns"],
    })
    expect(caps.isOwner).toBe(true)
  })
  it("is not an owner for an empty link array", () => {
    expect(deriveCapabilities({ role: "user", ownerIdentifiers: [] }).isOwner).toBe(false)
  })
  it("plain buyer has no capabilities", () => {
    expect(deriveCapabilities({ role: "user" })).toEqual({
      isAdmin: false,
      hasSeller: false,
      isOwner: false,
    })
  })
})

describe("visibleNavItems (marketplace)", () => {
  const labels = (caps: Parameters<typeof visibleNavItems>[1]) =>
    visibleNavItems("marketplace", caps).map((i) => i.label)

  it("hides My Listings from non-sellers", () => {
    expect(labels({ isAdmin: false, hasSeller: false, isOwner: false })).toEqual([
      "Browse",
      "Saved",
      "My Alerts",
      "Brand Requests",
    ])
  })
  it("shows My Listings to sellers", () => {
    expect(labels({ isAdmin: false, hasSeller: true, isOwner: false })).toContain(
      "My Listings"
    )
  })
})

describe("visibleNavItems (admin)", () => {
  it("returns all eight admin sections regardless of caps", () => {
    const labels = visibleNavItems("admin", {
      isAdmin: true,
      hasSeller: true,
      isOwner: false,
    }).map((i) => i.label)
    expect(labels).toEqual([
      "Queue",
      "Listings",
      "Inquiries",
      "Brand Requests",
      "Users",
      "Analytics",
      "Data",
      "Owners",
    ])
  })
})

describe("visiblePrimaryAction", () => {
  it("offers Add Listing to marketplace sellers", () => {
    expect(
      visiblePrimaryAction("marketplace", { isAdmin: false, hasSeller: true, isOwner: false })
        ?.href
    ).toBe("/seller/listings/new")
  })
  it("hides Add Listing from non-sellers", () => {
    expect(
      visiblePrimaryAction("marketplace", { isAdmin: false, hasSeller: false, isOwner: false })
    ).toBeNull()
  })
  it("has no primary action in admin world", () => {
    expect(
      visiblePrimaryAction("admin", { isAdmin: true, hasSeller: true, isOwner: false })
    ).toBeNull()
  })
})

describe("isActive", () => {
  const browse: NavItem = { label: "Browse", href: "/browse", match: ["/browse", "/listings"] }
  const saved: NavItem = { label: "Saved", href: "/account/favorites" }
  const myListings: NavItem = { label: "My Listings", href: "/seller/listings", match: ["/seller"] }
  const adminListings: NavItem = { label: "Listings", href: "/admin/listings" }

  it("matches exact path", () => {
    expect(isActive("/browse", browse)).toBe(true)
  })
  it("matches a listing detail under Browse", () => {
    expect(isActive("/listings/abc-123", browse)).toBe(true)
  })
  it("does not mark Browse active on the favorites page", () => {
    expect(isActive("/account/favorites", browse)).toBe(false)
    expect(isActive("/account/favorites", saved)).toBe(true)
  })
  it("matches any seller subpage for My Listings", () => {
    expect(isActive("/seller/listings/9/edit", myListings)).toBe(true)
  })
  it("matches admin listing detail for admin Listings", () => {
    expect(isActive("/admin/listings/55", adminListings)).toBe(true)
  })
  it("does not false-match a sibling prefix", () => {
    expect(isActive("/browser", browse)).toBe(false)
  })
})

describe("no admin leakage in marketplace", () => {
  it("non-admin sees no admin links in marketplace world", () => {
    const items = visibleNavItems("marketplace", {
      isAdmin: false,
      hasSeller: false,
      isOwner: false,
    })
    expect(items.every((i) => !i.href.startsWith("/admin"))).toBe(true)
  })
  it("admin capability does not inject admin links into marketplace world", () => {
    const items = visibleNavItems("marketplace", {
      isAdmin: true,
      hasSeller: true,
      isOwner: true,
    })
    expect(items.every((i) => !i.href.startsWith("/admin"))).toBe(true)
  })
})

describe("tabLabel", () => {
  it("shortens Brand Requests for the tab bar", () => {
    expect(tabLabel("/account/brand-requests", "Brand Requests")).toBe("Brands")
  })
  it("keeps the existing short labels", () => {
    expect(tabLabel("/account/alerts", "My Alerts")).toBe("Alerts")
    expect(tabLabel("/seller/listings", "My Listings")).toBe("Listings")
  })
  it("falls back to the nav label when there is no override", () => {
    expect(tabLabel("/browse", "Browse")).toBe("Browse")
  })
  it("resolves every marketplace tab to a single word", () => {
    // A two-word label wraps at five tabs on a 390px screen, which grows the
    // fixed bar past the 3.5rem .pb-tabbar reserves and pushes it up over the
    // map's floating controls.
    for (const item of MARKETPLACE_NAV) {
      expect(tabLabel(item.href, item.label)).not.toMatch(/\s/)
    }
  })
})
