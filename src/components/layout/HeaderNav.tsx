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
    <header className="sticky top-0 z-40 bg-[#ED1845] text-white">
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
            className="md:hidden flex items-center justify-center w-11 h-11 rounded-lg hover:bg-white/15"
            aria-label="Open menu"
            aria-expanded={open}
          >
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom tier — contextual */}
      <div className="border-t border-white/15">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 h-12">
            <div className="min-w-0">
              {title && (
                <h1 className="text-base font-semibold text-white truncate leading-tight">
                  {title}
                </h1>
              )}
              {subtitle && <p className="text-xs text-white/80 truncate">{subtitle}</p>}
            </div>
            <nav className="hidden md:flex items-center gap-1">
              {items.map((item) => {
                const active = isActive(pathname, item)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`text-sm font-semibold px-3 py-1.5 rounded-full transition-colors ${
                      active
                        ? "bg-white text-[#ED1845] shadow-sm"
                        : "text-white/90 hover:bg-white/15"
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
              {action && (
                <Link
                  href={action.href}
                  className="ml-1 text-sm font-bold text-[#ED1845] bg-white hover:bg-white/90 px-3.5 py-1.5 rounded-full shadow-md transition-colors"
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
        <div className="px-4 pt-4 pb-safe-lg border-t border-gray-200">
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
