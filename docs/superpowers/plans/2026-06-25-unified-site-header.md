# Unified Site Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inconsistent per-area navigation with one shared two-tier header (global controls + world switcher on top, page title + world-scoped links below) applied across all authenticated pages.

**Architecture:** A single pure-logic module (`src/lib/navigation.ts`) defines the two "worlds" (Marketplace / Admin), their links, and capability gating. A thin async server component (`SiteHeader`) resolves the session and delegates rendering to a client component (`HeaderNav`) that owns the two-tier layout, active-link highlighting, the world switcher, the account menu, and the mobile drawer. Marketplace pages render `SiteHeader` per-page (so they can pass live counts); the `/seller` and `/admin` route layouts render it once for their whole section.

**Tech Stack:** Next.js App Router (server + client components), React, Tailwind CSS (brand tokens `hs-red-*`), next-auth (`auth()` server, `signOut` client), vitest (node environment).

## Global Constraints

- This is a customized Next.js — before writing routing/component code, consult the relevant guide under `node_modules/next/dist/docs/` (per `AGENTS.md`). Heed deprecation notices.
- Use the brand color tokens already defined in `src/app/globals.css` (`hs-red-600` = `#dc2626`, etc.) — never hardcode hex.
- vitest runs in the **node** environment and only includes `src/__tests__/**/*.test.ts` (see `vitest.config.mts`). Put unit tests there. Do **not** add React component render tests — that would require adding jsdom and changing the include globs (out of scope). Logic lives in `navigation.ts` and is fully unit-tested; components are verified by type-check + manual smoke.
- Type-check gate for component tasks: `npx tsc --noEmit` (fallback: `npm run build`).
- Capability gating semantics must not change: `isAdmin = role === "admin"`, `hasSeller = sellerAccess || isAdmin`, `isOwner = !!ownerIdentifier`.
- Non-admins must never see the world switcher or any Admin link.
- Commit messages follow the repo convention (Conventional Commits subject + the project's `Co-Authored-By` / `Claude-Session` trailer).

---

### Task 1: Navigation config & helpers (pure logic)

**Files:**
- Create: `src/lib/navigation.ts`
- Test: `src/__tests__/navigation.test.ts`

**Interfaces:**
- Produces:
  - `type NavWorld = "marketplace" | "admin"`
  - `interface NavItem { label: string; href: string; match?: string[]; requires?: "seller" | "owner" }`
  - `interface Capabilities { isAdmin: boolean; hasSeller: boolean; isOwner: boolean }`
  - `interface SessionUserLike { role?: string | null; sellerAccess?: boolean | null; ownerIdentifier?: string | null }`
  - `interface PrimaryAction { label: string; href: string; requires?: "seller" | "owner" }`
  - `deriveCapabilities(user: SessionUserLike): Capabilities`
  - `visibleNavItems(world: NavWorld, caps: Capabilities): NavItem[]`
  - `visiblePrimaryAction(world: NavWorld, caps: Capabilities): PrimaryAction | null`
  - `isActive(currentPath: string, item: NavItem): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/navigation.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import {
  deriveCapabilities,
  visibleNavItems,
  visiblePrimaryAction,
  isActive,
  type NavItem,
} from "@/lib/navigation"

describe("deriveCapabilities", () => {
  it("treats role=admin as admin AND seller", () => {
    const caps = deriveCapabilities({ role: "admin" })
    expect(caps).toEqual({ isAdmin: true, hasSeller: true, isOwner: false })
  })
  it("grants seller via sellerAccess without admin", () => {
    const caps = deriveCapabilities({ role: "user", sellerAccess: true })
    expect(caps).toEqual({ isAdmin: false, hasSeller: true, isOwner: false })
  })
  it("marks owner when ownerIdentifier present", () => {
    const caps = deriveCapabilities({ role: "user", ownerIdentifier: "OWN-1" })
    expect(caps.isOwner).toBe(true)
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
    ])
  })
  it("shows My Listings to sellers", () => {
    expect(labels({ isAdmin: false, hasSeller: true, isOwner: false })).toContain(
      "My Listings"
    )
  })
})

describe("visibleNavItems (admin)", () => {
  it("returns all six admin sections regardless of caps", () => {
    const labels = visibleNavItems("admin", {
      isAdmin: true,
      hasSeller: true,
      isOwner: false,
    }).map((i) => i.label)
    expect(labels).toEqual([
      "Queue",
      "Listings",
      "Inquiries",
      "Users",
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/navigation.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/navigation"` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `src/lib/navigation.ts`:

```ts
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
  ownerIdentifier?: string | null
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
    isOwner: !!user.ownerIdentifier,
  }
}

export const MARKETPLACE_NAV: NavItem[] = [
  { label: "Browse", href: "/browse", match: ["/browse", "/listings"] },
  { label: "Saved", href: "/account/favorites" },
  { label: "My Alerts", href: "/account/alerts" },
  { label: "My Listings", href: "/seller/listings", match: ["/seller"], requires: "seller" },
]

export const ADMIN_NAV: NavItem[] = [
  { label: "Queue", href: "/admin/queue" },
  { label: "Listings", href: "/admin/listings" },
  { label: "Inquiries", href: "/admin/inquiries" },
  { label: "Users", href: "/admin/users" },
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/navigation.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/navigation.ts src/__tests__/navigation.test.ts
git commit -m "feat(nav): navigation config and capability/active-link helpers"
```

---

### Task 2: Hello Sugar logo asset + Logo component

**Files:**
- Create: `src/components/layout/Logo.tsx`
- Create (asset): `public/hello-sugar-logo.svg` (from brand kit, if available)

**Interfaces:**
- Produces: `Logo({ href }: { href: string })` — a linked brand mark.

- [ ] **Step 1: Obtain the official logo**

Invoke the `hello-sugar-brand` skill to get the official Hello Sugar logo. If it yields an SVG (or PNG), save it as `public/hello-sugar-logo.svg` (or `.png`). If no usable asset is produced, skip the file and use the wordmark fallback below — the component still renders correctly.

- [ ] **Step 2: Write the Logo component**

Create `src/components/layout/Logo.tsx`:

```tsx
import Link from "next/link"

/**
 * Brand mark in the header. Links to the current world's home.
 * Uses the official logo asset when present in /public; otherwise a wordmark.
 */
export function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label="Hello Sugar Marketplace">
      {/* If public/hello-sugar-logo.svg exists, prefer it:
          <img src="/hello-sugar-logo.svg" alt="Hello Sugar" className="h-7 w-auto" /> */}
      <span
        className="font-bold italic text-xl text-hs-red-600 leading-none"
        style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
      >
        hello sugar
      </span>
    </Link>
  )
}
```

If you saved an asset in Step 1, replace the `<span>` with the commented `<img>` line (point `src` at the saved filename) and delete the wordmark.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors referencing `Logo.tsx`).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Logo.tsx public/hello-sugar-logo.svg 2>/dev/null; git add src/components/layout/Logo.tsx
git commit -m "feat(nav): Hello Sugar logo component for the header"
```

---

### Task 3: WorldSwitcher (client)

**Files:**
- Create: `src/components/layout/WorldSwitcher.tsx`

**Interfaces:**
- Consumes: `type NavWorld` from `@/lib/navigation`.
- Produces: `WorldSwitcher({ world }: { world: NavWorld })`. **Callers render this only when `caps.isAdmin`.**

- [ ] **Step 1: Write the component**

Create `src/components/layout/WorldSwitcher.tsx`:

```tsx
"use client"

import Link from "next/link"
import type { NavWorld } from "@/lib/navigation"

/** Marketplace / Admin segmented toggle. Render only for admins. */
export function WorldSwitcher({ world }: { world: NavWorld }) {
  const base = "text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
  const isAdmin = world === "admin"
  return (
    <div
      role="group"
      aria-label="Switch between Marketplace and Admin"
      className={`inline-flex p-0.5 rounded-lg ${
        isAdmin ? "bg-gray-900" : "bg-gray-100 border border-gray-200"
      }`}
    >
      <Link
        href="/browse"
        aria-current={!isAdmin ? "page" : undefined}
        className={`${base} ${
          !isAdmin ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-white"
        }`}
      >
        Marketplace
      </Link>
      <Link
        href="/admin"
        aria-current={isAdmin ? "page" : undefined}
        className={`${base} ${
          isAdmin ? "bg-hs-red-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-900"
        }`}
      >
        Admin
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/WorldSwitcher.tsx
git commit -m "feat(nav): Marketplace/Admin world switcher"
```

---

### Task 4: AccountMenu (client)

**Files:**
- Create: `src/components/layout/AccountMenu.tsx`

**Interfaces:**
- Produces: `AccountMenu({ email, isAdmin, isOwner }: { email: string; isAdmin: boolean; isOwner: boolean })` — avatar button + dropdown (email, Admin badge, My Locations for owners, Sign out).

- [ ] **Step 1: Write the component**

Create `src/components/layout/AccountMenu.tsx`:

```tsx
"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { signOut } from "next-auth/react"

interface AccountMenuProps {
  email: string
  isAdmin: boolean
  isOwner: boolean
}

export function AccountMenu({ email, isAdmin, isOwner }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const initials = (email.slice(0, 2) || "?").toUpperCase()

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    if (open) {
      document.addEventListener("mousedown", onClick)
      document.addEventListener("keydown", onEsc)
    }
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-full bg-gray-900 text-white text-xs font-bold flex items-center justify-center hover:opacity-90 transition"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        {initials}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-2 z-50"
        >
          <div className="px-4 py-2 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900 truncate">{email}</p>
            {isAdmin && (
              <span className="inline-block mt-1 text-xs font-semibold bg-gray-900 text-white px-2 py-0.5 rounded">
                Admin
              </span>
            )}
          </div>
          {isOwner && (
            <Link
              href="/account/locations"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              My Locations
            </Link>
          )}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            role="menuitem"
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AccountMenu.tsx
git commit -m "feat(nav): account avatar menu"
```

---

### Task 5: HeaderNav (client) — two-tier shell + mobile drawer

**Files:**
- Create: `src/components/layout/HeaderNav.tsx`

**Interfaces:**
- Consumes: `Logo`, `WorldSwitcher`, `AccountMenu`; `type NavWorld`, `type Capabilities`, `type NavItem`, `type PrimaryAction`, `visibleNavItems`, `visiblePrimaryAction`, `isActive` from `@/lib/navigation`.
- Produces: `HeaderNav({ world, caps, email, title, subtitle }: { world: NavWorld; caps: Capabilities; email: string; title?: string; subtitle?: string })` — renders the full `<header>` (top tier + bottom tier + mobile drawer). When `title` is omitted the bottom-tier title area is empty (links only).

- [ ] **Step 1: Write the component**

Create `src/components/layout/HeaderNav.tsx`:

```tsx
"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Logo } from "./Logo"
import { WorldSwitcher } from "./WorldSwitcher"
import { AccountMenu } from "./AccountMenu"
import {
  type NavWorld,
  type Capabilities,
  type NavItem,
  type PrimaryAction,
  visibleNavItems,
  visiblePrimaryAction,
  isActive,
} from "@/lib/navigation"

interface HeaderNavProps {
  world: NavWorld
  caps: Capabilities
  email: string
  title?: string
  subtitle?: string
}

export function HeaderNav({ world, caps, email, title, subtitle }: HeaderNavProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const items = visibleNavItems(world, caps)
  const action = visiblePrimaryAction(world, caps)
  const logoHref = world === "admin" ? "/admin" : "/browse"

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    if (open) {
      document.addEventListener("keydown", onEsc)
      document.body.classList.add("drawer-open")
    }
    return () => {
      document.removeEventListener("keydown", onEsc)
      document.body.classList.remove("drawer-open")
    }
  }, [open])

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      {/* Top tier — global */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <Logo href={logoHref} />
          <div className="hidden md:flex items-center gap-3">
            {caps.isAdmin && <WorldSwitcher world={world} />}
            <AccountMenu email={email} isAdmin={caps.isAdmin} isOwner={caps.isOwner} />
          </div>
          <button
            onClick={() => setOpen(true)}
            className="md:hidden flex items-center justify-center w-11 h-11 rounded-lg hover:bg-gray-100"
            aria-label="Open menu"
            aria-expanded={open}
          >
            <svg className="w-6 h-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom tier — contextual */}
      <div className="border-t border-gray-100 bg-gray-50/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 h-12">
            <div className="min-w-0">
              {title && (
                <h1 className="text-base font-semibold text-gray-900 truncate leading-tight">
                  {title}
                </h1>
              )}
              {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
            </div>
            <nav className="hidden md:flex items-center gap-1">
              {items.map((item) => {
                const active = isActive(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
                      active
                        ? "bg-gray-200/70 text-gray-900 font-semibold"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
              {action && (
                <Link
                  href={action.href}
                  className="ml-1 text-sm font-semibold text-white bg-hs-red-600 hover:bg-hs-red-700 px-3.5 py-1.5 rounded-lg transition-colors"
                >
                  {action.label}
                </Link>
              )}
            </nav>
          </div>
        </div>
      </div>

      {open && (
        <MobileDrawer
          world={world}
          caps={caps}
          email={email}
          items={items}
          action={action}
          pathname={pathname}
          onClose={() => setOpen(false)}
        />
      )}
    </header>
  )
}

function MobileDrawer({
  world,
  caps,
  email,
  items,
  action,
  pathname,
  onClose,
}: {
  world: NavWorld
  caps: Capabilities
  email: string
  items: NavItem[]
  action: PrimaryAction | null
  pathname: string
  onClose: () => void
}) {
  const otherWorldHref = world === "admin" ? "/browse" : "/admin"
  const otherWorldLabel = world === "admin" ? "Switch to Marketplace" : "Switch to Admin"
  const groupLabel = "px-3 pt-4 pb-1 text-xs font-bold uppercase tracking-wide text-gray-400"
  const link = "block px-3 py-2.5 rounded-lg text-base text-gray-700 hover:bg-gray-100"

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xs bg-white shadow-xl md:hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <span className="font-semibold text-gray-900">Menu</span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-gray-100"
          >
            <svg className="w-6 h-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <p className={`${groupLabel} pt-2`}>{world === "admin" ? "Admin" : "Marketplace"}</p>
          {items.map((item) => {
            const active = isActive(pathname, item)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`block px-3 py-2.5 rounded-lg text-base ${
                  active ? "bg-hs-red-50 text-hs-red-600 font-semibold" : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </Link>
            )
          })}
          {action && (
            <Link
              href={action.href}
              onClick={onClose}
              className="block px-3 py-2.5 rounded-lg text-base font-semibold text-white bg-hs-red-600 hover:bg-hs-red-700"
            >
              {action.label}
            </Link>
          )}
          {caps.isAdmin && (
            <>
              <p className={groupLabel}>Switch</p>
              <Link href={otherWorldHref} onClick={onClose} className={link}>
                {otherWorldLabel}
              </Link>
            </>
          )}
          <p className={groupLabel}>Account</p>
          {caps.isOwner && (
            <Link href="/account/locations" onClick={onClose} className={link}>
              My Locations
            </Link>
          )}
          <p className="px-3 py-1 text-sm text-gray-500 truncate">{email}</p>
        </nav>
        <div className="px-4 py-4 border-t border-gray-200">
          <button
            onClick={() => {
              onClose()
              signOut({ callbackUrl: "/login" })
            }}
            className="w-full px-4 py-3 rounded-lg border border-gray-300 text-base font-medium text-gray-700 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/HeaderNav.tsx
git commit -m "feat(nav): two-tier HeaderNav with mobile drawer"
```

---

### Task 6: SiteHeader (server) — session → capabilities → HeaderNav

**Files:**
- Create: `src/components/layout/SiteHeader.tsx`

**Interfaces:**
- Consumes: `auth` from `@/auth`; `deriveCapabilities`, `type NavWorld` from `@/lib/navigation`; `HeaderNav`.
- Produces: `async SiteHeader({ world, title, subtitle }: { world: NavWorld; title?: string; subtitle?: string })`. Renders `null` if unauthenticated (pages already redirect first). **This replaces `AppHeader`.**

- [ ] **Step 1: Write the component**

Create `src/components/layout/SiteHeader.tsx`:

```tsx
import { auth } from "@/auth"
import { deriveCapabilities, type NavWorld } from "@/lib/navigation"
import { HeaderNav } from "./HeaderNav"

interface SiteHeaderProps {
  world: NavWorld
  title?: string
  subtitle?: string
}

export async function SiteHeader({ world, title, subtitle }: SiteHeaderProps) {
  const session = await auth()
  const user = session?.user
  if (!user) return null

  const caps = deriveCapabilities({
    role: user.role,
    sellerAccess: user.sellerAccess,
    ownerIdentifier: user.ownerIdentifier,
  })

  return (
    <HeaderNav
      world={world}
      caps={caps}
      email={user.email ?? ""}
      title={title}
      subtitle={subtitle}
    />
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If `user.role` / `user.sellerAccess` / `user.ownerIdentifier` report type errors, confirm they match the fields read in existing pages (e.g. `src/app/browse/page.tsx:61-65`); they are already part of the augmented session type, so no new typing is needed.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/SiteHeader.tsx
git commit -m "feat(nav): SiteHeader server wrapper resolving session capabilities"
```

---

### Task 7: Wire Marketplace pages + retire AppHeader/UserNav

**Files:**
- Modify: `src/components/browse/BrowsePage.tsx` (remove its `AppHeader`)
- Modify: `src/app/browse/page.tsx` (render `SiteHeader` around `BrowsePage`)
- Modify: `src/app/account/alerts/page.tsx`
- Modify: `src/app/account/favorites/page.tsx`
- Modify: `src/app/account/locations/page.tsx`
- Modify: `src/app/listings/[id]/page.tsx`
- Delete: `src/components/layout/AppHeader.tsx`, `src/components/browse/UserNav.tsx`

**Interfaces:**
- Consumes: `SiteHeader` from `@/components/layout/SiteHeader`.

- [ ] **Step 1: Remove the header from `BrowsePage` (client component)**

In `src/components/browse/BrowsePage.tsx`:
- Delete the import `import { AppHeader } from "@/components/layout/AppHeader"`.
- Delete the entire `<AppHeader ... />` block (currently lines ~115-121).
- Remove the now-unused props `isAdmin`, `hasSeller`, `isOwner` from the `BrowsePageProps` interface and the function signature, leaving `initialListings` and `favoriteIds`. (Leave `favoriteIds` untouched.)

Resulting signature:

```tsx
interface BrowsePageProps {
  initialListings: ListingCard[]
  favoriteIds?: string[]
}

export function BrowsePage({ initialListings, favoriteIds = [] }: BrowsePageProps) {
```

The root `<div className="flex flex-col min-h-screen bg-gray-50">` stays; the filter bar is now its first child.

- [ ] **Step 2: Render `SiteHeader` in the browse route**

In `src/app/browse/page.tsx`, update `BrowseContent` (the server async fn) to render the header and drop the capability props it used to pass:

```tsx
import { SiteHeader } from "@/components/layout/SiteHeader"
// ...
async function BrowseContent({ searchParams }: { searchParams: RawSearchParams }) {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }

  const { items: initialListings } = await getListings(parseFilters(searchParams))
  const count = initialListings.length

  return (
    <>
      <SiteHeader
        world="marketplace"
        title="Browse Listings"
        subtitle={`${count} active listing${count !== 1 ? "s" : ""}`}
      />
      <BrowsePage initialListings={initialListings} />
    </>
  )
}
```

(Remove the now-unused `isAdmin` / `hasSeller` / `isOwner` locals.)

- [ ] **Step 3: Verify browse builds and the sticky filter bar still behaves**

Run: `npm run dev`, open `/browse`. Confirm the two-tier header renders, links highlight, and scrolling does not double-stack the sticky header and the sticky `FilterBar`. If they overlap, the simplest fix is to remove `top-0` stickiness from the desktop `FilterBar` wrapper in `BrowsePage` (the header already pins the top). Record the choice in the commit message.

- [ ] **Step 4: Swap the alerts page header**

In `src/app/account/alerts/page.tsx`:
- Replace `import { AppHeader } from "@/components/layout/AppHeader"` with `import { SiteHeader } from "@/components/layout/SiteHeader"`.
- Delete the three lines computing `isAdmin` / `hasSeller` / `isOwner`.
- Replace the `<AppHeader ... />` line with:

```tsx
<SiteHeader
  world="marketplace"
  title="My Alerts"
  subtitle={`${alerts.length} saved search${alerts.length !== 1 ? "es" : ""}`}
/>
```

- Delete the redundant `← Browse listings` `<Link>` in the body (the header now provides Browse). Keep the `<h2>Saved searches</h2>` sub-heading.

- [ ] **Step 5: Add the header to favorites and remove the duplicate title/breadcrumb**

In `src/app/account/favorites/page.tsx`:
- Remove `import { Breadcrumb } from '@/components/ui/Breadcrumb'`; add `import { SiteHeader } from '@/components/layout/SiteHeader'`.
- Replace the opening `<div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">` and the `<Breadcrumb .../>` + the title block (`<div className="flex items-center justify-between mb-6">…</div>`, which holds the `<h1>Saved Listings</h1>`, the count, and the "Browse more" link) with the header + a plain container:

```tsx
return (
  <>
    <SiteHeader
      world="marketplace"
      title="Saved Listings"
      subtitle={`${favoriteListings.length} saved listing${favoriteListings.length !== 1 ? 's' : ''}`}
    />
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {/* favoriteListings.length === 0 ? <EmptyStateIllustrated .../> : <grid> ... */}
    </div>
  </>
)
```

Keep the empty-state block and the grid exactly as they are.

- [ ] **Step 6: Add the header to My Locations and remove the duplicate title/breadcrumb**

In `src/app/account/locations/page.tsx`:
- Remove the `Breadcrumb` import; add `import { SiteHeader } from "@/components/layout/SiteHeader"`.
- Replace the `<Breadcrumb .../>` and the `<div className="mb-6">` title block (the `<h1>My Locations</h1>` + the descriptive `<p>`) with the header, moving that description text into the subtitle:

```tsx
return (
  <>
    <SiteHeader
      world="marketplace"
      title="My Locations"
      subtitle={
        ownerIdentifier
          ? `${locations.length} location${locations.length !== 1 ? "s" : ""} owned by you`
          : "Locations linked to your owner account"
      }
    />
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
      {/* rest of the page unchanged */}
    </div>
  </>
)
```

- [ ] **Step 7: Add the header to the listing detail page and remove its breadcrumb**

In `src/app/listings/[id]/page.tsx`:
- Remove `import { Breadcrumb } from '@/components/ui/Breadcrumb'`; add `import { SiteHeader } from '@/components/layout/SiteHeader'`.
- After `listing` is loaded, compute the display name the same way `generateMetadata` does:

```tsx
const primaryLocation = listing.locations[0]
const displayName =
  listing.title ||
  primaryLocation?.name ||
  [primaryLocation?.city, primaryLocation?.state].filter(Boolean).join(", ") ||
  "Listing"
```

- Delete the `<Breadcrumb .../>` element in the returned JSX and render `<SiteHeader world="marketplace" title={displayName} />` as the first element (wrap the existing returned tree in a fragment if needed). Leave the listing's main content (photos, financials, contact form) unchanged.

- [ ] **Step 8: Delete the retired components and confirm no references remain**

```bash
git rm src/components/layout/AppHeader.tsx src/components/browse/UserNav.tsx
```

Run: search for leftover references.
Use Grep for `AppHeader` and `browse/UserNav` across `src/`.
Expected: no matches under `src/` (matches only in `docs/`).

- [ ] **Step 9: Type-check, test, and commit**

Run: `npx tsc --noEmit` → PASS.
Run: `npx vitest run` → PASS (navigation tests + existing suite).

```bash
git add -A
git commit -m "feat(nav): adopt SiteHeader across marketplace pages; remove AppHeader/UserNav"
```

---

### Task 8: Wire the Seller section layout

**Files:**
- Modify: `src/app/seller/layout.tsx`

**Interfaces:**
- Consumes: `SiteHeader`.

- [ ] **Step 1: Replace the seller nav with `SiteHeader`**

In `src/app/seller/layout.tsx`, keep the auth/access guard, but replace the entire custom `<nav>…</nav>` block with `<SiteHeader world="marketplace" />` (no title — seller pages keep their own headings and live counts). Add the import.

```tsx
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SiteHeader } from '@/components/layout/SiteHeader'

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  if (!session.user.sellerAccess && session.user.role !== 'admin') {
    redirect('/access-denied')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader world="marketplace" />
      <main className="max-w-5xl mx-auto px-4 lg:px-6 py-8">{children}</main>
    </div>
  )
}
```

The removed `Link` import is no longer used — delete it.

- [ ] **Step 2: Verify and commit**

Run: `npm run dev`, open `/seller/listings`. Confirm the marketplace header shows, "My Listings" is the active link, the world switcher appears for admins, and the page's own content/headings are intact.
Run: `npx tsc --noEmit` → PASS.

```bash
git add src/app/seller/layout.tsx
git commit -m "feat(nav): use SiteHeader in the seller section layout"
```

---

### Task 9: Wire the Admin section layout

**Files:**
- Modify: `src/app/admin/layout.tsx`

**Interfaces:**
- Consumes: `SiteHeader`.

- [ ] **Step 1: Replace the admin nav with `SiteHeader`**

In `src/app/admin/layout.tsx`, keep the admin auth guard, but replace the entire custom `<nav>…</nav>` block (and the `NavLink` helper at the bottom of the file) with `<SiteHeader world="admin" />`. Admin pages keep their own title blocks and counts (e.g. `admin/queue/page.tsx` renders "Approval Queue · N pending").

```tsx
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { SiteHeader } from '@/components/layout/SiteHeader'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }
  if (session.user.role !== 'admin') {
    redirect('/access-denied')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <SiteHeader world="admin" />
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-8">{children}</main>
    </div>
  )
}
```

Delete the now-unused `Link` import and the `NavLink` function.

- [ ] **Step 2: Verify and commit**

Run: `npm run dev`, open `/admin/queue`. Confirm the admin header shows all six section links with the correct one active, the switcher is in its Admin (dark/red) state, and clicking "Marketplace" navigates to `/browse`.
Run: `npx tsc --noEmit` → PASS.

```bash
git add src/app/admin/layout.tsx
git commit -m "feat(nav): use SiteHeader in the admin section layout"
```

---

### Task 10: Full verification & cross-role smoke test

**Files:** none (verification only).

- [ ] **Step 1: Static checks**

Run: `npx tsc --noEmit` → PASS.
Run: `npx eslint src/components/layout src/lib/navigation.ts` → no errors.
Run: `npx vitest run` → all PASS.
Run: `npm run build` → completes without errors.

- [ ] **Step 2: Manual smoke (dev server)**

With `npm run dev`, verify each scenario:
- **Admin user:** switcher visible; Marketplace ⇄ Admin both work; admin world shows the six section links; marketplace world shows Browse/Saved/My Alerts/My Listings + "+ Add Listing".
- **Seller (non-admin):** no switcher; sees My Listings + "+ Add Listing"; cannot reach `/admin` via the header.
- **Plain buyer (no seller, no owner):** no switcher, no My Listings, no Add Listing, no My Locations in the account menu.
- **Owner:** "My Locations" appears in the account dropdown (desktop) and the Account group (mobile drawer).
- **Active link:** `/listings/<id>` highlights "Browse"; `/seller/listings/<id>` highlights "My Listings"; `/admin/listings/<id>` highlights "Listings".
- **Mobile (narrow viewport):** top tier collapses to logo + hamburger; drawer shows grouped links, the "Switch to Admin" group only for admins, and Sign out works.
- **Pages with no header before:** `/account/favorites`, `/account/locations`, `/listings/<id>` now show the header with no duplicated title.
- **Untouched:** `/` (landing) and `/login` still show their original chrome.

- [ ] **Step 3: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(nav): verification fixes for unified header"
```

(If Step 1–2 surface no issues, no commit is needed.)

---

## Self-Review

**Spec coverage:**
- One consistent header across authenticated pages → Tasks 6–9 (per-page marketplace + section layouts).
- Distinct worlds + admin-only switcher → `WorldSwitcher` (Task 3), gated in `HeaderNav` (Task 5) by `caps.isAdmin`.
- Real Hello Sugar logo → Task 2.
- Capability gating unchanged → centralized in `deriveCapabilities`/`visibleNavItems` (Task 1), consumed by `SiteHeader` (Task 6); covered by tests.
- Two worlds' link sets, primary action, My Locations in account menu → Tasks 1, 4, 5.
- Mobile drawer with grouped links + switch-to-admin → Task 5.
- Rollout map (which routes, which world) → Tasks 7–9, matching the spec table.
- Breadcrumb cleanup on favorites/locations/listing-detail → Task 7.
- No standalone Saved/Alerts quick-icons (avoid duplication) → not added; section links only.
- Testing plan (gating + active-link) → Task 1 unit tests; render tests intentionally omitted per the node-only vitest setup (documented in Global Constraints).

**Placeholder scan:** No TBD/TODO; every code step contains complete code; commands have expected output.

**Type consistency:** `NavWorld`, `Capabilities`, `NavItem`, `PrimaryAction`, `deriveCapabilities`, `visibleNavItems`, `visiblePrimaryAction`, `isActive` are defined in Task 1 and consumed with identical names/signatures in Tasks 5–6. `SiteHeader({ world, title?, subtitle? })` and `HeaderNav({ world, caps, email, title?, subtitle? })` are used consistently across Tasks 5–9.

**Note on title strategy:** Bottom-tier title is explicit-only. Marketplace pages pass it (Task 7); the seller/admin layouts pass none, so their pages keep their own title blocks and live counts (Tasks 8–9) — no duplicate titles, no per-page title cleanup required.
