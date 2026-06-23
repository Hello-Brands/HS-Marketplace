const BRAND_PREFIX = /^hello\s+sugar\b/

/** Canonical comparison form: lowercase, drop the brand prefix and punctuation, collapse spaces. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[—–-]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(BRAND_PREFIX, "")
    .trim()
}

/** Token Jaccard similarity in [0,1]. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const sa = new Set(a.split(" ").filter(Boolean))
  const sb = new Set(b.split(" ").filter(Boolean))
  if (sa.size === 0 || sb.size === 0) return 0
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  return inter / (sa.size + sb.size - inter)
}

export function suggestLocationMatch(
  locationName: string,
  candidates: { id: string; name: string }[]
): { id: string; name: string; confidence: number } | null {
  const target = normalizeName(locationName)
  let best: { id: string; name: string; confidence: number } | null = null
  for (const loc of candidates) {
    const confidence = similarity(target, normalizeName(loc.name))
    if (!best || confidence > best.confidence) best = { id: loc.id, name: loc.name, confidence }
  }
  return best && best.confidence >= 0.5 ? best : null
}
