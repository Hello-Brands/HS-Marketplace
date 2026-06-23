const MAPTILER_GEOCODING_BASE = "https://api.maptiler.com/geocoding"

// Params the widget legitimately sends that we forward upstream. Anything else
// (including a client-supplied `key`) is dropped.
const ALLOWED_PARAMS = [
  "country",
  "types",
  "proximity",
  "autocomplete",
  "limit",
  "language",
  "bbox",
  "fuzzyMatch",
] as const

/**
 * Build the upstream MapTiler geocoding URL from the proxy's catch-all segments
 * and incoming query params, injecting the server API key. The client key (if
 * any) is ignored; only allow-listed params are forwarded.
 */
export function buildUpstreamGeocodeUrl(
  segments: string[],
  searchParams: URLSearchParams,
  apiKey: string
): string {
  const raw = segments.join("/").replace(/\.json$/i, "")
  const url = new URL(`${MAPTILER_GEOCODING_BASE}/${encodeURIComponent(raw)}.json`)
  for (const key of ALLOWED_PARAMS) {
    const value = searchParams.get(key)
    if (value !== null) url.searchParams.set(key, value)
  }
  url.searchParams.set("key", apiKey)
  return url.toString()
}
