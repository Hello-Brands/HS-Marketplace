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
      className="inline-flex p-0.5 rounded-lg bg-white/18"
    >
      <Link
        href="/browse"
        aria-current={!isAdmin ? "page" : undefined}
        className={`${base} ${
          !isAdmin ? "bg-white text-hs-red-600 shadow-sm" : "text-white hover:bg-white/10"
        }`}
      >
        Marketplace
      </Link>
      <Link
        href="/admin"
        aria-current={isAdmin ? "page" : undefined}
        className={`${base} ${
          isAdmin ? "bg-white text-hs-red-600 shadow-sm" : "text-white hover:bg-white/10"
        }`}
      >
        Admin
      </Link>
    </div>
  )
}
