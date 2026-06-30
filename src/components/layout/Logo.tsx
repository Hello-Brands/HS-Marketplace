import Link from "next/link"

/**
 * Brand mark in the header — the white horizontal logo, shown on the red masthead.
 * Links to the current world's home.
 */
export function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center" aria-label="Hello Sugar Marketplace">
      <img src="/logo-horizontal-white.png" alt="Hello Sugar" className="h-8 w-auto" />
    </Link>
  )
}
