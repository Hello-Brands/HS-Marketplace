"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { type NavItem, isActive } from "@/lib/navigation"
import { tabBarHiddenForPath } from "@/lib/tab-bar"

// Persistent bottom navigation on mobile (Zillow-style). Marketplace world
// only — SiteHeader renders it. Account/world-switch/sign-out stay in the
// hamburger drawer, so there is no "Menu" tab.

// Short labels for the tight tab layout; falls back to the nav label.
//
// Every marketplace tab MUST resolve to a single word here. A two-word label
// wraps at five tabs on a 390px screen, and because the bar is fixed to the
// bottom the extra height grows UPWARD over the content — covering the browse
// map's floating List pill and layers button. This map is tab-bar-only, so the
// desktop nav and the hamburger drawer keep the full "Brand Requests".
const TAB_LABELS: Record<string, string> = {
  "/account/alerts": "Alerts",
  "/account/brand-requests": "Brands",
  "/seller/listings": "Listings",
}

/** Tab-bar label for a nav href, falling back to the full nav label. */
export function tabLabel(href: string, fallback: string): string {
  return TAB_LABELS[href] ?? fallback
}

const ICON_PROPS = {
  className: "w-6 h-6",
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  strokeWidth: 2,
  "aria-hidden": true,
} as const

const TAB_ICONS: Record<string, React.ReactNode> = {
  "/browse": (
    <svg {...ICON_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
    </svg>
  ),
  "/account/favorites": (
    <svg {...ICON_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
    </svg>
  ),
  "/account/alerts": (
    <svg {...ICON_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  ),
  "/seller/listings": (
    <svg {...ICON_PROPS}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5a2 2 0 011.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
}

export function MobileTabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  if (tabBarHiddenForPath(pathname)) return null

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-gray-200 pb-safe"
    >
      <div className="flex">
        {items.map((item) => {
          const active = isActive(pathname, item)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[44px] min-w-0 flex-1 flex-col items-center gap-0.5 pt-1.5 pb-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-inset ${
                active ? "text-hs-red-600" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {TAB_ICONS[item.href] ?? TAB_ICONS["/browse"]}
              <span className="w-full truncate whitespace-nowrap text-center">
                {tabLabel(item.href, item.label)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
