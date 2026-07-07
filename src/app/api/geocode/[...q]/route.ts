import { buildUpstreamGeocodeUrl } from "@/lib/geocode/url"
import { requireSession } from "@/lib/auth-guards"
import { checkRateLimit } from "@/lib/rate-limit"
import { env } from "@/lib/env"

// Proxies MapTiler geocoding using the UNRESTRICTED server key so in-browser
// autocomplete works on any origin (the public key is referer-restricted to
// prod). Server-only: the key never reaches the client.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ q: string[] }> }
) {
  // Defense-in-depth: this proxy spends our unrestricted server API key, so
  // require a session at the handler level in case the middleware is bypassed.
  let userId: string
  try {
    const user = await requireSession()
    userId = user.id as string
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Throttle per user (DEBT-028). Interactive autocomplete fires several
  // debounced requests as the user types, so allow a generous burst but cap
  // sustained abuse that would burn our MapTiler quota. Best-effort (see
  // rate-limit.ts): per-instance only, not a distributed guarantee.
  const limit = checkRateLimit(`geocode:${userId}`, 30, 10_000)
  if (!limit.allowed) {
    return Response.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "retry-after": String(Math.ceil((limit.retryAfterMs ?? 0) / 1000)),
        },
      },
    )
  }

  const apiKey = env.MAPTILER_API_KEY
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
