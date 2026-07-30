'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Invisible poller: re-runs the server component tree on an interval.
 *
 * Exists because some rows are written OUT OF BAND (e.g. the competitor-monitor
 * repo advances brand_requests over its own DB connection), so the page has no
 * mutation of its own to refresh from. Render it only while something is
 * actually in flight, and unmount it otherwise — every tick is a full RSC
 * request. Hidden tabs are skipped.
 */
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) router.refresh()
    }, intervalMs)

    return () => clearInterval(timer)
  }, [router, intervalMs])

  return null
}
