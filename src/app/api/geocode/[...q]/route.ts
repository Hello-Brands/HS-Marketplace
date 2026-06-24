import { buildUpstreamGeocodeUrl } from "@/lib/geocode/url"

// Proxies MapTiler geocoding using the UNRESTRICTED server key so in-browser
// autocomplete works on any origin (the public key is referer-restricted to
// prod). Server-only: the key never reaches the client.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ q: string[] }> }
) {
  const apiKey = process.env.MAPTILER_API_KEY
  if (!apiKey) {
    return Response.json({ error: "geocoding unavailable" }, { status: 503 })
  }

  const { q } = await params
  const incoming = new URL(request.url).searchParams
  const upstream = buildUpstreamGeocodeUrl(q ?? [], incoming, apiKey)

  try {
    const res = await fetch(upstream)
    const body = await res.text()
    return new Response(body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
        "cache-control":
          res.headers.get("cache-control") ??
          "public, max-age=60, s-maxage=86400, stale-while-revalidate=604800",
      },
    })
  } catch {
    return Response.json({ error: "geocoding upstream failed" }, { status: 502 })
  }
}
