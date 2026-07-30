export type NavWorld = "marketplace" | "admin"

export interface NavItem {
  label: string
  href: string
  /** Path prefixes that mark this item active. Defaults to [href]. */
  match?: string[]
  /** Capability required to see this item. Omit = always visible in its world. */
  requires?: "seller" | "owner"
}

export interface Capabilities {
  isAdmin: boolean
  hasSeller: boolean
  isOwner: boolean
}

/** Minimal shape of the authenticated user we read for gating. */
export interface SessionUserLike {
  role?: string | null
  sellerAccess?: boolean | null
  ownerIdentifiers?: readonly string[] | null
}

export interface PrimaryAction {
  label: string
  href: string
  requires?: "seller" | "owner"
}

export function deriveCapabilities(user: SessionUserLike): Capabilities {
  const isAdmin = user.role === "admin"
  return {
    isAdmin,
    hasSeller: !!user.sellerAccess || isAdmin,
    isOwner: !!user.ownerIdentifiers?.length,
  }
}

export const MARKETPLACE_NAV: NavItem[] = [
  { label: "Browse", href: "/browse", match: ["/browse", "/listings"] },
  { label: "Saved", href: "/account/favorites" },
  { label: "My Alerts", href: "/account/alerts" },
  { label: "Brand Requests", href: "/account/brand-requests" },
  { label: "My Listings", href: "/seller/listings", match: ["/seller"], requires: "seller" },
]

export const ADMIN_NAV: NavItem[] = [
  { label: "Queue", href: "/admin/queue" },
  { label: "Listings", href: "/admin/listings" },
  { label: "Inquiries", href: "/admin/inquiries" },
  { label: "Brand Requests", href: "/admin/brand-requests" },
  { label: "Users", href: "/admin/users" },
  { label: "Analytics", href: "/admin/analytics" },
  { label: "Data", href: "/admin/data" },
  { label: "Owners", href: "/admin/owner-directory" },
]

const PRIMARY_ACTION: Record<NavWorld, PrimaryAction | null> = {
  marketplace: { label: "+ Add Listing", href: "/seller/listings/new", requires: "seller" },
  admin: null,
}

function meets(requires: NavItem["requires"], caps: Capabilities): boolean {
  if (!requires) return true
  if (requires === "seller") return caps.hasSeller
  return caps.isOwner // "owner"
}

function navItems(world: NavWorld): NavItem[] {
  return world === "admin" ? ADMIN_NAV : MARKETPLACE_NAV
}

export function visibleNavItems(world: NavWorld, caps: Capabilities): NavItem[] {
  return navItems(world).filter((item) => meets(item.requires, caps))
}

export function visiblePrimaryAction(world: NavWorld, caps: Capabilities): PrimaryAction | null {
  const action = PRIMARY_ACTION[world]
  if (!action) return null
  return meets(action.requires, caps) ? action : null
}

export function isActive(currentPath: string, item: NavItem): boolean {
  const patterns = item.match ?? [item.href]
  return patterns.some((p) => currentPath === p || currentPath.startsWith(p + "/"))
}
