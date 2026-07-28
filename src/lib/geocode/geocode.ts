import "server-only"
import { buildGeocodeQueries, parseUsAddressTail } from "./address"
import {
  isAcceptableMatch,
  toCandidate,
  type GeocodeCandidate,
  type MapTilerFeature,
} from "./match"
import { env } from "@/lib/env"

const MAPTILER_GEOCODING_BASE = "https://api.maptiler.com/geocoding"

async function fetchTop(query: string, apiKey: string): Promise<GeocodeCandidate | null> {
  const url = `${MAPTILER_GEOCODING_BASE}/${encodeURIComponent(
    query,
  )}.json?key=${apiKey}&country=us&limit=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as { features?: MapTilerFeature[] }
  return toCandidate(data.features?.[0])
}

/**
 * Server-side forward geocode for one address. Best-effort: returns null (never
 * throws) when the key is missing, the address is unusable, the upstream fails,
 * or no candidate is trustworthy — so callers can geocode inline without ever
 * blocking the surrounding write.
 *
 * Tries progressively simpler queries and stops at the first acceptable match,
 * so a well-formed address still costs exactly one request. The accept rule
 * lives in ./match and is shared with scripts/geocode-owner-locations.ts.
 */
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lng: number; relevance: number } | null> {
  const apiKey = env.MAPTILER_API_KEY
  if (!apiKey) return null

  const queries = buildGeocodeQueries(address)
  if (queries.length === 0) return null
  const expectedZip = parseUsAddressTail(address)?.zipCode ?? null

  try {
    for (const query of queries) {
      const candidate = await fetchTop(query, apiKey)
      if (!candidate) continue
      if (isAcceptableMatch(candidate, expectedZip)) {
        return { lat: candidate.lat, lng: candidate.lng, relevance: candidate.relevance }
      }
    }
    return null
  } catch {
    return null
  }
}
