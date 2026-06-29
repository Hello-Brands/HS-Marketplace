export interface LoginTrendPoint {
  date: string
  count: number
}

/** Zero-fill a daily series: `days` points, oldest first, last point = today (UTC). */
export function fillTrend(
  rows: { date: string; count: number }[],
  days: number,
  today: Date,
): LoginTrendPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r.count]))
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const out: LoginTrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10)
    out.push({ date, count: byDate.get(date) ?? 0 })
  }
  return out
}
