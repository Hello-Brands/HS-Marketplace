# Browse Map-Default + Location Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the map the default browse view, fix city/state/ZIP autocomplete by proxying MapTiler geocoding through a server route, and drop a center pin + radius circle on select (with search usable on mobile).

**Architecture:** Keep MapTiler's `GeocodingControl`, but point its `apiUrl` at a new `/api/geocode/[...q]` route that forwards to MapTiler using the unrestricted server key (bypassing the public key's referer restriction that blocks the browser). `MapView` gains a branded center pin. `BrowsePage` defaults to map and exposes search on mobile.

**Tech Stack:** Next.js 15 (App Router, async route `params`), React 19, `@maptiler/geocoding-control` ^2.1.7, `@maptiler/sdk` ^3.11.1, Vitest, Tailwind (`hs-red-*` brand scale).

## Global Constraints

- Next.js dynamic API route params are `Promise`-wrapped: `{ params }: { params: Promise<{ q: string[] }> }`, `await params`. (Repo convention — see `src/app/api/kpi/[locationId]/route.ts`.)
- Server-only secret: `MAPTILER_API_KEY` (unrestricted) must never reach the client. The public `NEXT_PUBLIC_MAPTILER_API_KEY` stays for map tiles only.
- Brand: use the repo's `hs-red-*` Tailwind scale and `--font-source-sans`; crimson is `#db2777`.
- Tests: Vitest, run with `npx vitest run <path>`; tests live under `src/__tests__/`; the `@` alias maps to `src/`.
- Verify between tasks: `npx tsc --noEmit` must stay clean.

---

### Task 1: Geocode upstream-URL builder (pure)

**Files:**
- Create: `src/lib/geocode/url.ts`
- Test: `src/__tests__/geocode/url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildUpstreamGeocodeUrl(segments: string[], searchParams: URLSearchParams, apiKey: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/geocode/url.test.ts
import { describe, it, expect } from "vitest"
import { buildUpstreamGeocodeUrl } from "@/lib/geocode/url"

describe("buildUpstreamGeocodeUrl", () => {
  it("injects the server key and ignores a client-supplied key", () => {
    const u = new URL(
      buildUpstreamGeocodeUrl(["Boise.json"], new URLSearchParams("key=CLIENT"), "SERVER")
    )
    expect(u.searchParams.get("key")).toBe("SERVER")
  })

  it("strips the trailing .json and percent-encodes the query", () => {
    const u = new URL(
      buildUpstreamGeocodeUrl(["Salt Lake City.json"], new URLSearchParams(), "K")
    )
    expect(u.hostname).toBe("api.maptiler.com")
    expect(u.pathname).toBe("/geocoding/Salt%20Lake%20City.json")
  })

  it("forwards only allow-listed params", () => {
    const u = new URL(
      buildUpstreamGeocodeUrl(
        ["x.json"],
        new URLSearchParams("country=us&types=place&proximity=-98,39&evil=1"),
        "K"
      )
    )
    expect(u.searchParams.get("country")).toBe("us")
    expect(u.searchParams.get("types")).toBe("place")
    expect(u.searchParams.get("proximity")).toBe("-98,39")
    expect(u.searchParams.has("evil")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/geocode/url.test.ts`
Expected: FAIL — cannot resolve `@/lib/geocode/url`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/geocode/url.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/geocode/url.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/geocode/url.ts src/__tests__/geocode/url.test.ts
git commit -m "feat(browse): geocode upstream-URL builder (server-key injection + param allowlist)"
```

---

### Task 2: Geocoding proxy route

**Files:**
- Create: `src/app/api/geocode/[...q]/route.ts`
- Test: `src/__tests__/geocode/route.test.ts`

**Interfaces:**
- Consumes: `buildUpstreamGeocodeUrl` (Task 1); `process.env.MAPTILER_API_KEY`.
- Produces: `GET(request: Request, ctx: { params: Promise<{ q: string[] }> }): Promise<Response>` at `/api/geocode/*`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/geocode/route.test.ts
import { describe, it, expect, vi, afterEach } from "vitest"
import { GET } from "@/app/api/geocode/[...q]/route"

const OLD_KEY = process.env.MAPTILER_API_KEY

afterEach(() => {
  process.env.MAPTILER_API_KEY = OLD_KEY
  vi.restoreAllMocks()
})

describe("GET /api/geocode/[...q]", () => {
  it("returns 503 when the server key is missing", async () => {
    delete process.env.MAPTILER_API_KEY
    const res = await GET(new Request("http://localhost/api/geocode/Boise.json"), {
      params: Promise.resolve({ q: ["Boise.json"] }),
    })
    expect(res.status).toBe(503)
  })

  it("forwards to MapTiler with the server key, ignoring the client key", async () => {
    process.env.MAPTILER_API_KEY = "SERVER"
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await GET(
      new Request("http://localhost/api/geocode/Boise.json?country=us&key=CLIENT"),
      { params: Promise.resolve({ q: ["Boise.json"] }) }
    )

    expect(res.status).toBe(200)
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain("api.maptiler.com/geocoding/Boise.json")
    expect(calledUrl).toContain("key=SERVER")
    expect(calledUrl).not.toContain("CLIENT")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/geocode/route.test.ts`
Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/api/geocode/[...q]/route.ts
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
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    })
  } catch {
    return Response.json({ error: "geocoding upstream failed" }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/geocode/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/geocode src/__tests__/geocode/route.test.ts
git commit -m "feat(browse): server-side geocoding proxy route"
```

---

### Task 3: Point LocationSearch at the proxy + branding/visibility

**Files:**
- Modify: `src/components/browse/LocationSearch.tsx`
- Modify: `src/app/globals.css` (append scoped overrides)

**Interfaces:**
- Consumes: `/api/geocode` (Task 2).
- Produces: unchanged `LocationSearch` public API — `onSelect({ lng, lat, name })`.

- [ ] **Step 1: Update the widget config**

Replace the `<GeocodingControl .../>` return in `src/components/browse/LocationSearch.tsx` with the version below. Changes: wrap in a branded container, route via `apiUrl`, add a fixed US-centroid `proximity` bias (the default `server-geolocation` would resolve against our proxy server's IP, not the user's), and cap results.

```tsx
  return (
    <div className="hs-geocoder">
      <GeocodingControl
        apiKey={process.env.NEXT_PUBLIC_MAPTILER_API_KEY!}
        apiUrl="/api/geocode"
        country={["US"]}
        types={["place", "postcode", "region"]}
        proximity={[{ type: "fixed", coordinates: [-98.5795, 39.8283] }]}
        limit={5}
        class="hs-geocoder-control"
        onPick={handlePick}
        placeholder="Search by city, state, or zip..."
      />
    </div>
  )
```

(The proxy overrides the client `apiKey`; it's kept only because the widget builds its request URL from it.)

- [ ] **Step 2: Append scoped CSS overrides to `src/app/globals.css`**

```css
/* MapTiler geocoding control — Hello Sugar overrides (browse search) */
.hs-geocoder {
  position: relative;
  z-index: 50; /* keep the suggestions dropdown above the map below it */
  width: 100%;
}
.hs-geocoder .maptiler-ctrl,
.hs-geocoder .maplibregl-ctrl-geocoder {
  width: 100%;
  box-shadow: none;
  font-family: var(--font-source-sans), system-ui, sans-serif;
}
.hs-geocoder .options {
  z-index: 60;
}
.hs-geocoder input:focus {
  outline: 2px solid #db2777;
  outline-offset: 1px;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (exit 0). If `proximity`/`class` types error, the names are confirmed in `node_modules/@maptiler/geocoding-control/types.d.ts` (`class?: string`, `proximity?: ProximityRule[]` with `{ type: "fixed"; coordinates: Position }`).

- [ ] **Step 4: Manual verification (run the app)**

```bash
npm run dev
```
Open http://localhost:3000/browse, type "Salt Lake City" in the search box. Expected: a suggestions dropdown appears (Salt Lake City, UT near the top), rendered above the map, in the brand font with a crimson focus ring. In the browser Network tab, requests go to `/api/geocode/...` and return 200 (not `api.maptiler.com` directly, and no 403). If the dropdown appears but is clipped/hidden, increase `.hs-geocoder`/`.options` `z-index` or check for an ancestor `overflow:hidden`; if it's still empty, confirm the `/api/geocode` response in Network has `features`.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/LocationSearch.tsx src/app/globals.css
git commit -m "feat(browse): route geocoding through proxy + brand the suggestions dropdown"
```

---

### Task 4: Center pin in MapView

**Files:**
- Modify: `src/components/browse/MapView.tsx`

**Interfaces:**
- Consumes: existing `center?: { lng: number; lat: number } | null` prop.
- Produces: a branded center marker that appears/moves/clears with `center` (no signature change).

- [ ] **Step 1: Add a ref for the center marker**

In `MapView`, alongside the other refs (after `const mapReady = useRef(false)`), add:

```tsx
  const centerMarker = useRef<maptilersdk.Marker | null>(null)
```

- [ ] **Step 2: Add the center-pin effect**

Add this effect immediately after the existing radius-circle effect (after the `}, [center, radiusMiles])` effect):

```tsx
  // Drop / move / remove the branded search-center pin.
  useEffect(() => {
    const m = map.current
    if (!m) return

    const apply = () => {
      if (centerMarker.current) {
        centerMarker.current.remove()
        centerMarker.current = null
      }
      if (center) {
        const el = document.createElement("div")
        const inner = document.createElement("div")
        // hs-red-600 teardrop pin, anchored at its tip; distinct from the
        // smaller pink listing dots.
        inner.innerHTML = `
          <svg width="30" height="38" viewBox="0 0 24 24" fill="#db2777"
               stroke="white" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <circle cx="12" cy="9" r="2.5" fill="white" stroke="none"/>
          </svg>`
        inner.style.cssText = "filter: drop-shadow(0 2px 3px rgba(0,0,0,0.35));"
        el.appendChild(inner)
        centerMarker.current = new maptilersdk.Marker({ element: el, anchor: "bottom" })
          .setLngLat([center.lng, center.lat])
          .addTo(m)
      }
    }

    if (mapReady.current) apply()
    else m.once("load", apply)
  }, [center])
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 4: Manual verification (run the app)**

With `npm run dev` running, on `/browse` search a city and pick a suggestion. Expected: a crimson teardrop pin drops at the selected location with its tip on the point, alongside the translucent radius circle, and the map zooms to fit. Changing the radius keeps the pin; clearing the location (the chip's ✕) removes both pin and circle.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/MapView.tsx
git commit -m "feat(browse): drop a branded center pin at the searched location"
```

---

### Task 5: Map as default view + search on mobile

**Files:**
- Modify: `src/components/browse/BrowsePage.tsx`

**Interfaces:**
- Consumes: `LocationSearch` (Task 3), `MapView` (Task 4) — unchanged signatures.
- Produces: map-default view; search/radius controls visible on mobile.

- [ ] **Step 1: Default to map view**

In `src/components/browse/BrowsePage.tsx`, change the initial view state:

```tsx
  const [viewMode, setViewMode] = useState<"list" | "map">("map")
```

- [ ] **Step 2: Make the controls row wrap and show search on mobile**

Find the controls container (currently `<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">`) and add `flex-wrap`:

```tsx
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
```

Then change the search block wrapper from desktop-only to a full-width row on mobile. Replace:

```tsx
          {/* Location search + radius + Save search — hidden on mobile */}
          <div className="hidden sm:flex items-center gap-3 flex-1 justify-end">
```

with:

```tsx
          {/* Location search + radius + Save search */}
          <div className="flex w-full sm:w-auto sm:flex-1 items-center gap-3 justify-end order-last sm:order-none">
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (exit 0).

- [ ] **Step 4: Manual verification (run the app)**

With `npm run dev` running:
- Desktop (`/browse`): the page opens in **map** view by default; the search bar sits in the controls row; the list/map toggle still switches views.
- Mobile (DevTools device toolbar, ~390px wide): the search bar appears on its own full-width row below the Filters button + view toggle (not hidden), and searching drops the pin + radius. Confirm the search row doesn't overlap the Filters button or toggle.

- [ ] **Step 5: Commit**

```bash
git add src/components/browse/BrowsePage.tsx
git commit -m "feat(browse): default to map view and enable location search on mobile"
```

---

### Task 6: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all pass (existing 175 + 5 new from Tasks 1–2).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: exit 0; `/api/geocode/[...q]` listed as a route.

- [ ] **Step 3: Final manual smoke (run the app)**

On `/browse`: map is default; typing a city shows suggestions (via `/api/geocode`, HTTP 200); picking one drops the crimson pin + radius circle and zooms; radius select updates the circle; clearing removes pin + circle; search works at mobile width.

- [ ] **Step 4: (No commit — verification only.)**

---

## Notes for the implementer

- **Why the proxy:** both API keys geocode fine server-side, but the public key is referer-restricted, so the in-browser widget got blocked (no suggestions). The proxy uses the unrestricted server key and keeps it server-side.
- **Map tiles** still use `NEXT_PUBLIC_MAPTILER_API_KEY` directly in `MapView` — unchanged. If tiles also fail on localhost, that key needs localhost added to its allowed origins in MapTiler Cloud (config, not code).
- **Prod env:** `MAPTILER_API_KEY` is already in `.env.local` and documented in `.env.example`; ensure it's set in Vercel (it should already be, for the existing geocoding backfill).
