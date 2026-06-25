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
