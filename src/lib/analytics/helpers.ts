const MS_PER_DAY = 86_400_000

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Whole calendar days (UTC) between start and now; never negative. */
export function daysListed(start: Date, now: Date): number {
  return Math.max(0, Math.floor((utcMidnight(now) - utcMidnight(start)) / MS_PER_DAY))
}

/** A view counts unless it's the listing's own seller or any admin. */
export function shouldRecordView(p: {
  viewerId: string
  sellerId: string
  viewerRole: string
}): boolean {
  if (p.viewerId === p.sellerId) return false
  if (p.viewerRole === "admin") return false
  return true
}

/** Set-once listedAt: stamp 'now' only the first time we go active. */
export function nextListedAt(current: Date | null, targetStatus: string, now: Date): Date | null {
  if (targetStatus === "active") return current ?? now
  return current
}
