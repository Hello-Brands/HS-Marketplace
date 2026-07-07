import { MONTH_ABBR } from "@/lib/month"

/** Average rating to a fixed two-decimal string, e.g. 4.84. */
export function formatRating(avg: number): string {
  return avg.toFixed(2)
}

/** Five star slots, rounded to the nearest half star. */
export function starStates(avg: number): ("full" | "half" | "empty")[] {
  const rounded = Math.round(avg * 2) / 2 // nearest 0.5
  return Array.from({ length: 5 }, (_, i) => {
    const slot = i + 1
    if (rounded >= slot) return "full"
    if (rounded >= slot - 0.5) return "half"
    return "empty"
  })
}

/** "YYYY-MM-DD" -> "Jun 2026"; "" for empty/malformed input. */
export function formatReviewDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date)
  if (!m) return ""
  const monthIdx = Number(m[2]) - 1
  const label = MONTH_ABBR[monthIdx]
  return label ? `${label} ${m[1]}` : ""
}
