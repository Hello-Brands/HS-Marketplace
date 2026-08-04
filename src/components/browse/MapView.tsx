"use client"

import { useEffect, useRef } from "react"
import * as maptilersdk from "@maptiler/sdk"
import "@maptiler/sdk/dist/maptiler-sdk.css"
import { formatUsdCentsCompact } from "@/lib/money"
import type { ListingCard } from "@/lib/listings-query"
import type { CompetitorClosure } from "@/lib/competitor-query"
import type { UnlistedHsLocation } from "@/lib/hs-locations-filter"
import { hsLocationPopupHtml } from "./hs-location-popup"
import { escapeHtml } from "@/lib/escape-html"
import { BRAND } from "@/lib/brand-colors"
import { isNewClosure, formatClosureDetected } from "@/lib/closure-recency"
import {
  MARKER_ICON,
  STAR_PATH,
  type MarkerVariant,
  type MarkerLayer,
  markerVariant,
  hsMarkerLayer,
  markerZIndex,
} from "@/lib/browse/map-markers"

interface MapViewProps {
  listings: ListingCard[]
  hoveredId: string | null
  onHover: (id: string | null) => void
  onListingClick: (id: string) => void
  center?: { lng: number; lat: number } | null
  radiusMiles?: number | null
  // Scraper-owned competitor closures rendered as a second, visually distinct
  // pin layer. Read-only — these are never listings and never navigate.
  competitors?: CompetitorClosure[]
  showCompetitors?: boolean
  showListings?: boolean
  // Open HS locations that are NOT for sale — map-only, hover-only, no navigation.
  hsLocations?: UnlistedHsLocation[]
  showHsLocations?: boolean
  // Ids of listings / unlisted HS locations the signed-in user owns — rendered
  // in brand green. Same size/shape as their layer; color is the only change.
  ownedListingIds?: string[]
  ownedHsLocationIds?: string[]
  // Legend toggle: when false, owned dots render exactly like non-owned dots.
  showMyLocations?: boolean
  // Actions offered by the pinned popup on OWNED unlisted HS dots only:
  // "View location" navigates to the owner detail page, "Watch this area" opens
  // the watch-area dialog. Non-owned HS dots just pin their preview popup.
  onHsLocationClick?: (id: string) => void
  onWatchArea?: (loc: UnlistedHsLocation) => void
  savedPlaceIds?: string[]
  onToggleSaveCompetitor?: (c: CompetitorClosure) => void
  // A competitor chosen from the list. `seq` bumps on every click so re-selecting
  // the same competitor still re-triggers the fly-to. null = nothing selected.
  selectedCompetitor?: { id: string; seq: number } | null
}

// Approximate a ground circle as a lat/lng polygon for the search-radius overlay.
function circlePolygon(lng: number, lat: number, radiusMiles: number, points = 64) {
  const latR = radiusMiles / 69
  const lngR = radiusMiles / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  const ring: [number, number][] = []
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * 2 * Math.PI
    ring.push([lng + lngR * Math.cos(t), lat + latR * Math.sin(t)])
  }
  return {
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [ring] },
    properties: {},
  }
}

const RADIUS_SOURCE = "search-radius"

// Run `fn` when the map style is ready: immediately if already loaded, otherwise
// on the next "load" event. Dedupes the readiness guard that was repeated across
// the marker/overlay effects (DEBT-014).
function runWhenMapReady(map: maptilersdk.Map, ready: boolean, fn: () => void) {
  if (ready) fn()
  else map.once("load", fn)
}

// Brand tokens for the competitor layer (kept inline to match the existing
// DOM-marker styling approach). Opportunities use the warm "warning" caramel so
// they read as a flag and stay distinct from the pink listing dots; the rest
// render as muted taupe diamonds.
const COMP_OPP = BRAND.warning // brand warning (caramel)
const COMP_OPP_HALO = "rgba(187,130,101,0.35)"
const COMP_MUTED = BRAND.taupe // brand taupe

function statusLabel(status: string): string {
  if (status === "CLOSED_PERMANENTLY") return "Permanently Closed"
  if (status === "CLOSED_TEMPORARILY") return "Temporarily Closed"
  return status
}

// Detail panel shown when a competitor pin is clicked. Brand-styled inline.
function competitorPopupHtml(c: CompetitorClosure, saved: boolean): string {
  const permanent = c.businessStatus === "CLOSED_PERMANENTLY"
  const statusBg = permanent ? BRAND.blush : BRAND.warningLight // danger-soft / warning-soft
  const statusFg = permanent ? BRAND.error : BRAND.warning // danger / warning
  const place = [c.city, c.state].filter(Boolean).map(escapeHtml).join(", ")

  const oppChip = c.isOpportunity
    ? `<div style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:${BRAND.warningLight};color:${BRAND.warning};padding:2px 8px;border-radius:999px;margin-bottom:6px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.26 6.6.7-4.95 4.5 1.4 6.54L12 16.77 6.05 20l1.4-6.54L2.5 8.96l6.6-.7L12 2z"/></svg>Opportunity</div>`
    : ""

  const detectedLine = formatClosureDetected(c.closedAt)
  const detected = detectedLine
    ? `<div style="font-size:11px;color:${BRAND.taupe};margin-top:6px;">${escapeHtml(detectedLine)}</div>`
    : ""

  const nearest =
    c.nearestHsName && c.nearestHsMiles != null
      ? `<div style="font-size:12px;color:${BRAND.taupe};margin-top:6px;">${c.nearestHsMiles.toFixed(1)} mi from ${escapeHtml(c.nearestHsName)}</div>`
      : ""

  const maps = c.mapsUrl
    ? `<a href="${escapeHtml(c.mapsUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:10px;font-size:12px;font-weight:600;color:${BRAND.crimson};text-decoration:none;">View on Google Maps →</a>`
    : ""

  const saveBtn = `
    <button type="button" data-save-place-id="${escapeHtml(c.googlePlaceId)}" aria-pressed="${saved}"
      style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;font-weight:600;cursor:pointer;background:none;border:none;padding:0;color:${saved ? BRAND.crimson : BRAND.taupe};">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="${saved ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${saved ? "Saved" : "Save competitor"}
    </button>`

  return `
    <div style="font-family:'Montserrat',system-ui,sans-serif;padding:4px 4px 2px;max-width:240px;">
      ${oppChip}
      <div style="font-size:15px;font-weight:700;color:${BRAND.ink};line-height:1.25;">${escapeHtml(c.brandName)}</div>
      <div style="margin-top:6px;">
        <span style="font-size:11px;font-weight:600;background:${statusBg};color:${statusFg};padding:2px 8px;border-radius:999px;">${escapeHtml(statusLabel(c.businessStatus))}</span>
      </div>
      <div style="font-size:12px;color:${BRAND.taupe};margin-top:8px;line-height:1.4;">${escapeHtml(c.address)}${place ? `<br/>${place}` : ""}</div>
      ${nearest}
      ${detected}
      ${maps}
      ${saveBtn}
    </div>`
}

// Content-box side of the diamond, per variant. Both variants use a 2px
// border that sits OUTSIDE this box (no box-sizing), so the rendered footprint
// is side + 4 — `inner` is sized to that footprint to keep the marker's overall
// size, and therefore MapTiler's centering, exactly as it was before.
const COMP_DIAMOND_SIDE = { opportunity: 11.3, plain: 12 } as const
const COMP_BORDER = 2

// A newly detected closure REPLACES its diamond with a gold star for the
// recency window, so it reads as new at a glance instead of carrying a fleck of
// gold in one corner. Sized a little larger than the diamonds' 16px
// point-to-point so the star's silhouette is legible at low zoom.
const COMP_STAR_SIZE = 20

// The pulse ring, shared by both marker shapes.
function newClosurePulseEl(inset: number): HTMLDivElement {
  const pulse = document.createElement("div")
  pulse.className = "hs-new-closure-pulse"
  pulse.style.cssText = `
    position: absolute;
    inset: -${inset}px;
    border-radius: 999px;
    border: 2px solid ${BRAND.gold};
    pointer-events: none;
  `
  return pulse
}

// Build the marker element for a competitor closure.
//
// `isNew` swaps the whole shape: a closure detected inside the recency window
// renders as a pulsing gold star, and only reverts to a diamond once the window
// lapses. The star is deliberately UNIFORM — a new opportunity and a new plain
// closure look identical — because newness outranks the opportunity flag for
// those two weeks. The distinction is still carried by the popup and the list
// card's chips, and the diamond's caramel/hollow fill returns afterwards.
function competitorMarkerEl(c: CompetitorClosure, isNew: boolean): HTMLDivElement {
  const el = document.createElement("div")
  el.dataset.competitorId = c.googlePlaceId

  // `inner` carries ONLY the hover scale. MapTiler rewrites the OUTER
  // element's transform every frame, so we must never touch that one.
  const inner = document.createElement("div")

  if (isNew) {
    inner.style.cssText = `
      position: relative;
      width: ${COMP_STAR_SIZE}px;
      height: ${COMP_STAR_SIZE}px;
      transform-origin: center;
      transition: transform 0.15s ease;
    `
    // Pulse first so it paints under the star.
    inner.appendChild(newClosurePulseEl(4))

    // No rotation anywhere on this shape — a star is drawn upright, so unlike
    // the diamond branch there is nothing here that `inner`'s hover scale could
    // fight with. The white stroke keeps the gold legible on pale map tiles.
    const star = document.createElement("div")
    star.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${COMP_STAR_SIZE}px;
      height: ${COMP_STAR_SIZE}px;
      cursor: pointer;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35));
    `
    star.innerHTML = `<svg width="${COMP_STAR_SIZE}" height="${COMP_STAR_SIZE}" viewBox="0 0 24 24" fill="${BRAND.gold}" stroke="white" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`
    inner.appendChild(star)

    el.appendChild(inner)
    return el
  }

  const side = c.isOpportunity ? COMP_DIAMOND_SIDE.opportunity : COMP_DIAMOND_SIDE.plain
  const footprint = side + COMP_BORDER * 2

  inner.style.cssText = `
    position: relative;
    width: ${footprint}px;
    height: ${footprint}px;
    transform-origin: center;
    transition: transform 0.15s ease;
  `

  // The 45° rotation lives HERE, not on `inner` — `inner` owns the hover scale,
  // and combining the two on one element is what forced this split.
  const diamond = document.createElement("div")
  if (c.isOpportunity) {
    // 11.3px box → ~16px point-to-point once rotated 45° (16 / √2), matching
    // the 16px location marks. Halo trimmed to a 2px ring.
    diamond.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${side}px;
      height: ${side}px;
      background-color: ${COMP_OPP};
      border: ${COMP_BORDER}px solid white;
      border-radius: 3px;
      cursor: pointer;
      box-shadow: 0 0 0 2px ${COMP_OPP_HALO}, 0 2px 4px rgba(0,0,0,0.3);
      transform: rotate(45deg);
    `
  } else {
    diamond.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${side}px;
      height: ${side}px;
      background-color: white;
      border: ${COMP_BORDER}px solid ${COMP_MUTED};
      border-radius: 2px;
      cursor: pointer;
      opacity: 0.75;
      box-shadow: 0 1px 2px rgba(0,0,0,0.25);
      transform: rotate(45deg);
    `
  }
  inner.appendChild(diamond)

  el.appendChild(inner)
  return el
}

// --- Hello Sugar location markers -------------------------------------------
// The three location layers render brand marks — see @/lib/browse/map-markers
// for which asset each variant maps to and why.

// Drop-shadows tuned per variant so each mark seats legibly on the light street
// map. The unlisted white mark gets a tighter dark halo so it doesn't dissolve
// into pale tiles the way a plain white glyph would.
const MARKER_SHADOW: Record<MarkerVariant, string> = {
  forSale: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))",
  owned: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))",
  unlisted: "drop-shadow(0 0 1px rgba(0,0,0,0.55)) drop-shadow(0 1px 3px rgba(0,0,0,0.45))",
}

const MARKER_SIZE = 16
// The wordmark badge is wide, not a square glyph — render it wider so it stays
// legible while matching the swirls' visual weight (24 × ~15.6px).
const BADGE_WIDTH = 24

// Build a brand-mark marker element. As with the competitor markers, the outer
// element is positioned by MapTiler (it rewrites `transform` every frame — we
// must never touch it); all visuals + the hover scale live on the inner <img>.
function hsIconMarkerEl(variant: MarkerVariant): HTMLDivElement {
  const el = document.createElement("div")
  const inner = document.createElement("img")
  inner.src = MARKER_ICON[variant]
  inner.alt = ""
  inner.draggable = false
  // The badge keeps its own aspect (height: auto) so border-radius clips the
  // actual red field instead of a letterboxed square.
  const size = variant === "forSale"
    ? `width: ${BADGE_WIDTH}px; height: auto; border-radius: 3px;`
    : `width: ${MARKER_SIZE}px; height: ${MARKER_SIZE}px; object-fit: contain;`
  inner.style.cssText = `
    display: block;
    ${size}
    cursor: pointer;
    transform-origin: center;
    filter: ${MARKER_SHADOW[variant]};
    transition: transform 0.15s ease;
  `
  el.appendChild(inner)
  return el
}

export function MapView({
  listings,
  hoveredId,
  onHover,
  onListingClick,
  center,
  radiusMiles,
  competitors = [],
  showCompetitors = true,
  showListings = true,
  hsLocations = [],
  showHsLocations = true,
  ownedListingIds = [],
  ownedHsLocationIds = [],
  showMyLocations = true,
  onHsLocationClick,
  onWatchArea,
  savedPlaceIds = [],
  onToggleSaveCompetitor,
  selectedCompetitor,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maptilersdk.Map | null>(null)
  const markers = useRef<{ marker: maptilersdk.Marker; id: string; layer: MarkerLayer }[]>([])
  const competitorMarkers = useRef<{ marker: maptilersdk.Marker; id: string }[]>([])
  // Popup tracked alongside the marker: it isn't attached via setPopup (see the
  // HS-location effect), so marker.remove() won't clean it up for us.
  const hsMarkers = useRef<{ marker: maptilersdk.Marker; popup: maptilersdk.Popup; id: string }[]>([])
  // Read inside marker listeners without making it a dependency of the marker effect.
  const onToggleSaveCompetitorRef = useRef(onToggleSaveCompetitor)
  onToggleSaveCompetitorRef.current = onToggleSaveCompetitor
  const mapReady = useRef(false)
  // Key of the listing ids the camera was last fitted to. Lets ownership
  // recolor rebuilds (showMyLocations/ownedListingIds changes) skip the
  // re-fit so the legend toggle never yanks the user's pan/zoom.
  const lastFittedListingIds = useRef<string | null>(null)
  const centerMarker = useRef<maptilersdk.Marker | null>(null)
  // Latest click handler, read inside marker listeners without making it a
  // dependency of the marker effect (keeps the effect from rebuilding markers).
  const onListingClickRef = useRef(onListingClick)
  onListingClickRef.current = onListingClick
  const onHsLocationClickRef = useRef(onHsLocationClick)
  onHsLocationClickRef.current = onHsLocationClick
  const onWatchAreaRef = useRef(onWatchArea)
  onWatchAreaRef.current = onWatchArea

  // Initialize map once
  useEffect(() => {
    if (map.current || !mapContainer.current) return

    maptilersdk.config.apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY!

    map.current = new maptilersdk.Map({
      container: mapContainer.current,
      style: maptilersdk.MapStyle.STREETS,
      center: [-95, 39],
      zoom: 4,
    })

    map.current.on("load", () => {
      mapReady.current = true
    })

    return () => {
      map.current?.remove()
      map.current = null
      mapReady.current = false
    }
  }, [])

  // Update markers when listings change
  useEffect(() => {
    if (!map.current) return

    const addMarkers = () => {
      // Remove existing markers
      markers.current.forEach(({ marker }) => marker.remove())
      markers.current = []

      if (!showListings) {
        lastFittedListingIds.current = null
        return
      }

      const validListings = listings.filter(
        (l) => l.latitude !== null && l.longitude !== null
      )

      const ownedListingSet = new Set(ownedListingIds)

      for (const listing of validListings) {
        // Outer element is positioned by MapTiler — it rewrites `transform`
        // (translate) every frame. We must NOT set its transform or give it a
        // CSS transition, or markers detach from the map (jump to 0,0 / lag
        // behind while panning). All visuals + hover animation live on `inner`.
        const isMine = showMyLocations && ownedListingSet.has(listing.id)
        const layer = hsMarkerLayer("listing", isMine)

        const el = hsIconMarkerEl(markerVariant("listing", isMine))
        el.dataset.listingId = listing.id
        el.style.zIndex = markerZIndex(layer)

        const popup = new maptilersdk.Popup({
          offset: 24,
          closeButton: false,
          maxWidth: "220px",
        }).setHTML(`
          <div style="font-family: sans-serif; padding: 4px;">
            ${listing.primaryPhotoUrl ? `<img src="${escapeHtml(listing.primaryPhotoUrl)}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:6px;margin-bottom:8px;" />` : ""}
            <div style="font-size:16px;font-weight:600;color:${BRAND.ink};">${formatUsdCentsCompact(listing.askingPrice)}</div>
            <div style="font-size:13px;color:${BRAND.taupe};">${[listing.city, listing.state].filter((v): v is string => Boolean(v)).map(escapeHtml).join(", ") || "Location not specified"}</div>
            <div style="margin-top:6px;">
              <span style="font-size:11px;font-weight:500;background:${BRAND.blush};color:${BRAND.crimsonStrong};padding:2px 8px;border-radius:999px;">${escapeHtml(listing.type.charAt(0).toUpperCase() + listing.type.slice(1))}</span>
            </div>
            <div style="margin-top:8px;font-size:13px;color:${BRAND.crimson};font-weight:500;">Click to view details →</div>
          </div>
        `)

        const marker = new maptilersdk.Marker({ element: el })
          .setLngLat([listing.longitude!, listing.latitude!])
          .setPopup(popup)
          .addTo(map.current!)

        // Hover: highlight the matching list card + show the preview popup.
        el.addEventListener("mouseenter", () => {
          onHover(listing.id)
          popup.addTo(map.current!)
        })
        el.addEventListener("mouseleave", () => {
          onHover(null)
          popup.remove()
        })
        // Click: open the listing's detail page.
        el.addEventListener("click", (e) => {
          e.stopPropagation()
          onListingClickRef.current(listing.id)
        })

        markers.current.push({ marker, id: listing.id, layer })
      }

      // Auto-fit bounds to show all markers — but only when the rendered
      // listing set changed, not when a rebuild merely recolors owned dots.
      const idsKey = validListings.map((l) => l.id).join(",")
      if (validListings.length > 0 && idsKey !== lastFittedListingIds.current) {
        lastFittedListingIds.current = idsKey
        const bounds = new maptilersdk.LngLatBounds()
        validListings.forEach((l) => {
          bounds.extend([l.longitude!, l.latitude!])
        })
        map.current?.fitBounds(bounds, { padding: 60, maxZoom: 14 })
      }
    }

    runWhenMapReady(map.current, mapReady.current, addMarkers)
  }, [listings, onHover, showListings, ownedListingIds.join(","), showMyLocations])

  // Highlight hovered marker. Note the non-hovered branch restores the marker's
  // BASE band — resetting zIndex to "" would drop it back to accidental DOM
  // order and silently undo the layer ordering.
  useEffect(() => {
    for (const { marker, id, layer } of markers.current) {
      const el = marker.getElement()
      const inner = el.firstElementChild as HTMLElement | null
      if (!inner) continue
      // Scale the inner element (MapTiler doesn't touch it); zIndex on the
      // outer element is safe (MapTiler doesn't set it).
      inner.style.transform = id === hoveredId ? "scale(1.3)" : "scale(1)"
      el.style.zIndex = markerZIndex(layer, id === hoveredId)
    }
  }, [hoveredId])

  // Highlight the competitor pin matching the hovered list row.
  useEffect(() => {
    for (const { marker, id } of competitorMarkers.current) {
      const el = marker.getElement()
      const inner = el.firstElementChild as HTMLElement | null
      if (!inner) continue
      inner.style.transform = id === hoveredId ? "scale(1.35)" : "scale(1)"
      el.style.zIndex = markerZIndex("competitor", id === hoveredId)
    }
  }, [hoveredId])

  // Draw / update / remove the search-radius circle and frame it.
  useEffect(() => {
    const m = map.current
    if (!m) return

    const apply = () => {
      if (center && radiusMiles) {
        const data = circlePolygon(center.lng, center.lat, radiusMiles)
        const existing = m.getSource(RADIUS_SOURCE) as maptilersdk.GeoJSONSource | undefined
        if (existing) {
          existing.setData(data as GeoJSON.Feature)
        } else {
          m.addSource(RADIUS_SOURCE, { type: "geojson", data: data as GeoJSON.Feature })
          // Brand crimson (hs-red-600) overlay.
          m.addLayer({
            id: `${RADIUS_SOURCE}-fill`,
            type: "fill",
            source: RADIUS_SOURCE,
            paint: { "fill-color": BRAND.crimson, "fill-opacity": 0.1 },
          })
          m.addLayer({
            id: `${RADIUS_SOURCE}-line`,
            type: "line",
            source: RADIUS_SOURCE,
            paint: { "line-color": BRAND.crimson, "line-width": 2, "line-opacity": 0.85 },
          })
        }
        // Frame the circle's bounding box.
        const latR = radiusMiles / 69
        const lngR = radiusMiles / (69 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01))
        m.fitBounds(
          [
            [center.lng - lngR, center.lat - latR],
            [center.lng + lngR, center.lat + latR],
          ],
          { padding: 60, maxZoom: 13 }
        )
      } else {
        if (m.getLayer(`${RADIUS_SOURCE}-fill`)) m.removeLayer(`${RADIUS_SOURCE}-fill`)
        if (m.getLayer(`${RADIUS_SOURCE}-line`)) m.removeLayer(`${RADIUS_SOURCE}-line`)
        if (m.getSource(RADIUS_SOURCE)) m.removeSource(RADIUS_SOURCE)
      }
    }

    runWhenMapReady(m, mapReady.current, apply)
  }, [center, radiusMiles])

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
          <svg width="30" height="38" viewBox="0 0 24 24" fill="${BRAND.crimson}"
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

    runWhenMapReady(m, mapReady.current, apply)
  }, [center])

  // Competitor-closure layer: a second, visually distinct marker set. Rebuilt
  // when the closures change or the layer is toggled. Independent of the listing
  // markers (no fitBounds here — listings own the viewport framing).
  useEffect(() => {
    const m = map.current
    if (!m) return

    const apply = () => {
      // Clear any existing competitor markers first.
      competitorMarkers.current.forEach(({ marker }) => marker.remove())
      competitorMarkers.current = []
      if (!showCompetitors) return

      const valid = competitors.filter(
        (c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
      )

      // One reading per rebuild so every marker agrees on "now".
      const now = new Date()

      for (const c of valid) {
        const el = competitorMarkerEl(c, isNewClosure(c.closedAt, now))
        el.style.zIndex = markerZIndex("competitor")
        const inner = el.firstElementChild as HTMLElement

        const popup = new maptilersdk.Popup({
          offset: 16,
          closeButton: true,
          maxWidth: "260px",
        }).setHTML(competitorPopupHtml(c, savedPlaceIds.includes(c.googlePlaceId)))

        // setPopup gives click-to-toggle for free; the close button + pinned
        // popup keep the Google Maps link reliably clickable.
        const marker = new maptilersdk.Marker({ element: el })
          .setLngLat([c.longitude, c.latitude])
          .setPopup(popup)
          .addTo(m)

        popup.on("open", () => {
          const btn = popup
            .getElement()
            ?.querySelector<HTMLButtonElement>("[data-save-place-id]")
          if (!btn || btn.dataset.bound === "1") return
          btn.dataset.bound = "1"
          btn.addEventListener("click", (e) => {
            e.stopPropagation()
            onToggleSaveCompetitorRef.current?.(c)
          })
        })

        el.addEventListener("mouseenter", () => {
          inner.style.transform = "scale(1.25)"
          el.style.zIndex = markerZIndex("competitor", true)
          onHover(c.googlePlaceId)
        })
        el.addEventListener("mouseleave", () => {
          inner.style.transform = "scale(1)"
          el.style.zIndex = markerZIndex("competitor")
          onHover(null)
        })

        competitorMarkers.current.push({ marker, id: c.googlePlaceId })
      }
    }

    runWhenMapReady(m, mapReady.current, apply)
  }, [competitors, showCompetitors, savedPlaceIds.join(","), onHover])

  // Unlisted Hello Sugar locations: a third marker layer of solid slate dots.
  // Hover previews a non-PII popup; a single click pins it open (click elsewhere
  // on the map dismisses it via closeOnClick). The dots themselves never
  // navigate — only the owned popup's View button does — and they have no
  // onHover coordination (they aren't in the list). The popup is deliberately
  // NOT attached via setPopup — the marker's built-in click-toggle would fight
  // the hover-open handler and demand a second click to reopen the popup.
  useEffect(() => {
    const m = map.current
    if (!m) return

    const apply = () => {
      hsMarkers.current.forEach(({ marker, popup }) => {
        popup.remove()
        marker.remove()
      })
      hsMarkers.current = []
      if (!showHsLocations) return

      const valid = hsLocations.filter(
        (l) => Number.isFinite(l.latitude) && Number.isFinite(l.longitude)
      )

      const ownedHsSet = new Set(ownedHsLocationIds)

      for (const loc of valid) {
        const isMine = showMyLocations && ownedHsSet.has(loc.id)

        const el = hsIconMarkerEl(markerVariant("hsLocation", isMine))
        el.dataset.hsLocationId = loc.id
        el.style.zIndex = markerZIndex(hsMarkerLayer("hsLocation", isMine))
        const inner = el.firstElementChild as HTMLElement

        const popup = new maptilersdk.Popup({
          offset: 24,
          closeButton: false,
          maxWidth: "220px",
          // These popups open on HOVER. focusAfterOpen defaults to true, which
          // would pull keyboard focus onto the owned variant's "View location"
          // button on every hover and dump focus back to <body> when the popup
          // is removed — shredding tab order for anyone passing the cursor over
          // the map.
          focusAfterOpen: false,
        })
          .setLngLat([loc.longitude, loc.latitude])
          .setHTML(hsLocationPopupHtml(loc, isMine))

        const marker = new maptilersdk.Marker({ element: el })
          .setLngLat([loc.longitude, loc.latitude])
          .addTo(m)

        let pinned = false
        el.addEventListener("mouseenter", () => {
          inner.style.transform = "scale(1.25)"
          popup.addTo(m)
        })
        el.addEventListener("mouseleave", () => {
          inner.style.transform = "scale(1)"
          if (!pinned) popup.remove()
        })
        // All HS dots pin the popup on click; owned popups carry View/Watch action
        // buttons (wired below). stopPropagation keeps the map's closeOnClick from
        // immediately dismissing a pinned popup.
        //
        // addTo() on an ALREADY-OPEN popup re-adds it: MapLibre's addTo starts
        // with `if (this._map) this.remove()`, and remove() fires "close" — which
        // would flip `pinned` straight back to false (the popup is already open
        // from mouseenter on desktop). So: only add when closed, and set `pinned`
        // AFTER, where no close event can clear it.
        el.addEventListener("click", (e) => {
          e.stopPropagation()
          if (!popup.isOpen()) popup.addTo(m)
          pinned = true
        })
        popup.on("close", () => {
          pinned = false
        })

        if (isMine) {
          popup.on("open", () => {
            const root = popup.getElement()
            const viewBtn = root?.querySelector<HTMLButtonElement>('[data-hs-popup-action="view"]')
            if (viewBtn && viewBtn.dataset.bound !== "1") {
              viewBtn.dataset.bound = "1"
              viewBtn.addEventListener("click", (e) => {
                e.stopPropagation()
                popup.remove()
                onHsLocationClickRef.current?.(loc.id)
              })
            }
            const watchBtn = root?.querySelector<HTMLButtonElement>('[data-hs-popup-action="watch"]')
            if (watchBtn && watchBtn.dataset.bound !== "1") {
              watchBtn.dataset.bound = "1"
              watchBtn.addEventListener("click", (e) => {
                e.stopPropagation()
                popup.remove()
                onWatchAreaRef.current?.(loc)
              })
            }
          })
        }

        hsMarkers.current.push({ marker, popup, id: loc.id })
      }
    }

    runWhenMapReady(m, mapReady.current, apply)
  }, [hsLocations, showHsLocations, ownedHsLocationIds.join(","), showMyLocations])

  // Fly to a competitor selected from the list and open its detail popup. The
  // competitor markers already exist (built by the effect above); we just locate
  // the matching one, recenter, and pop it open.
  useEffect(() => {
    const m = map.current
    if (!m || !selectedCompetitor) return
    const c = competitors.find((x) => x.googlePlaceId === selectedCompetitor.id)
    if (!c || !Number.isFinite(c.longitude) || !Number.isFinite(c.latitude)) return

    const focus = () => {
      m.flyTo({ center: [c.longitude, c.latitude], zoom: 15, speed: 1.2, essential: true })
      const entry = competitorMarkers.current.find((e) => e.id === selectedCompetitor.id)
      const popup = entry?.marker.getPopup()
      if (entry && popup && !popup.isOpen()) entry.marker.togglePopup()
    }

    runWhenMapReady(m, mapReady.current, focus)
  }, [selectedCompetitor, competitors])

  // `isolate` (isolation: isolate) is load-bearing, not cosmetic. Marker
  // z-indexes run 10–45 (see @/lib/browse/map-markers), and this container is
  // otherwise not a stacking context — so those values would escape into the
  // ROOT stacking context and compete with page chrome directly, beating the
  // map key (z-10), the floating view toggle (z-20), the mobile tab bar (z-30)
  // and the sticky header + its hamburger drawer (z-40). Isolating here keeps
  // every marker's z-index scoped to the map, so the bands still order markers
  // against each other while no marker can ever paint over app chrome.
  return (
    <div ref={mapContainer} className="isolate h-full w-full" />
  )
}
