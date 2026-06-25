import Link from "next/link"

/**
 * Brand mark in the header. Links to the current world's home.
 * Uses the official logo asset when present in /public; otherwise a wordmark.
 */
export function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2" aria-label="Hello Sugar Marketplace">
      <img src="/hello-sugar-logo.svg" alt="Hello Sugar" className="h-7 w-auto" />
    </Link>
  )
}
