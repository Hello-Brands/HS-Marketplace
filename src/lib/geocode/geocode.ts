import "server-only"
import { cleanAddress } from "./address"
import { env } from "@/lib/env"

const MAPTILER_GEOCODING_BASE = "https://api.maptiler.com/geocoding"
// MapTiler relevance (0..1) we trust enough to write automatically. Below this we
// return null and leave the row for the backfill script / manual review.
const RELEVANCE_THRESHOLD = 0.8

/**
 * Server-side forward geocode for one address. Best-effort: returns null (never
 * throws) when the key is missing, the address is unusable, the upstream fails,
 * or the match is below the relevance threshold — so callers can geocode inline
 * without ever blocking the surrounding write.
 */
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number; relevance: number } | null> {
  const apiKey = env.MAPTILER_API_KEY
  if (!apiKey) return null

  const query = cleanAddress(address)
  if (!query) return null

  try {
    const url = `${MAPTILER_GEOCODING_BASE}/${encodeURIComponent(
      query,
    )}.json?key=${apiKey}&country=us&limit=1`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as {
      features?: { center?: [number, number]; relevance?: number }[]
    }
    const top = data.features?.[0]
    if (!top?.center || (top.relevance ?? 0) < RELEVANCE_THRESHOLD) return null
    const [lng, lat] = top.center
    return { lat, lng, relevance: top.relevance ?? 0 }
  } catch {
    return null
  }
}
