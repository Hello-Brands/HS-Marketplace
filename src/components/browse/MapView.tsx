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
  // Click handler for OWNED unlisted HS dots only (navigates to the owner
  // detail page). Non-owned HS dots keep the pin-popup behavior.
  onHsLocationClick?: (id: string) => void
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

function formatClosedDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "America/Denver" })
}

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

  const detected = c.closedAt
    ? `<div style="font-size:11px;color:${BRAND.mauve};margin-top:6px;">Detected ${escapeHtml(formatClosedDate(c.closedAt))}</div>`
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

// Build the diamond marker element for a competitor closure.
function competitorMarkerEl(c: CompetitorClosure): HTMLDivElement {
  const el = document.createElement("div")
  el.dataset.competitorId = c.googlePlaceId

  // Inner element carries all visuals + the 45° rotation (MapTiler rewrites the
  // outer element's transform every frame, so we must not touch it).
  const inner = document.createElement("div")
  if (c.isOpportunity) {
    inner.style.cssText = `
      width: 16px;
      height: 16px;
      background-color: ${COMP_OPP};
      border: 2px solid white;
      border-radius: 3px;
      cursor: pointer;
      box-shadow: 0 0 0 4px ${COMP_OPP_HALO}, 0 2px 4px rgba(0,0,0,0.3);
      transform: rotate(45deg);
      transition: transform 0.15s ease;
    `
  } else {
    inner.style.cssText = `
      width: 12px;
      height: 12px;
      background-color: white;
      border: 2px solid ${COMP_MUTED};
      border-radius: 2px;
      cursor: pointer;
      opacity: 0.75;
      box-shadow: 0 1px 2px rgba(0,0,0,0.25);
      transform: rotate(45deg);
      transition: transform 0.15s ease;
    `
  }
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
  savedPlaceIds = [],
  onToggleSaveCompetitor,
  selectedCompetitor,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maptilersdk.Map | null>(null)
  const markers = useRef<{ marker: maptilersdk.Marker; id: string }[]>([])
  const competitorMarkers = useRef<{ marker: maptilersdk.Marker; id: string }[]>([])
  // Popup tracked alongside the marker: it isn't attached via setPopup (see the
  // HS-location effect), so marker.remove() won't clean it up for us.
  const hsMarkers = useRef<{ marker: maptilersdk.Marker; popup: maptilersdk.Popup; id: string }[]>([])
  // Read inside marker listeners without making it a dependency of the marker effect.
  const onToggleSaveCompetitorRef = useRef(onToggleSaveCompetitor)
  onToggleSaveCompetitorRef.current = onToggleSaveCompetitor
  const mapReady = useRef(false)
  const centerMarker = useRef<maptilersdk.Marker | null>(null)
  // Latest click handler, read inside marker listeners without making it a
  // dependency of the marker effect (keeps the effect from rebuilding markers).
  const onListingClickRef = useRef(onListingClick)
  onListingClickRef.current = onListingClick
  const onHsLocationClickRef = useRef(onHsLocationClick)
  onHsLocationClickRef.current = onHsLocationClick

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

      if (!showListings) return

      const validListings = listings.filter(
        (l) => l.latitude !== null && l.longitude !== null
      )

      const ownedListingSet = new Set(ownedListingIds)

      for (const listing of validListings) {
        // Outer element is positioned by MapTiler — it rewrites `transform`
        // (translate) every frame. We must NOT set its transform or give it a
        // CSS transition, or markers detach from the map (jump to 0,0 / lag
        // behind while panning). All visuals + hover animation live on `inner`.
        const el = document.createElement("div")
        el.dataset.listingId = listing.id

        const isMine = showMyLocations && ownedListingSet.has(listing.id)
        const baseColor = isMine ? BRAND.success : BRAND.crimson
        const hoverColor = isMine ? BRAND.successStrong : BRAND.crimsonStrong

        const inner = document.createElement("div")
        inner.className = "map-marker"
        inner.dataset.baseColor = baseColor
        inner.dataset.hoverColor = hoverColor
        inner.style.cssText = `
          width: 16px;
          height: 16px;
          background-color: ${baseColor};
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          transition: transform 0.15s ease, background-color 0.15s ease;
        `
        el.appendChild(inner)

        const popup = new maptilersdk.Popup({
          offset: 20,
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

        markers.current.push({ marker, id: listing.id })
      }

      // Auto-fit bounds to show all markers
      if (validListings.length > 0) {
        const bounds = new maptilersdk.LngLatBounds()
        validListings.forEach((l) => {
          bounds.extend([l.longitude!, l.latitude!])
        })
        map.current?.fitBounds(bounds, { padding: 60, maxZoom: 14 })
      }
    }

    runWhenMapReady(map.current, mapReady.current, addMarkers)
  }, [listings, onHover, showListings, ownedListingIds.join(","), showMyLocations])

  // Highlight hovered marker
  useEffect(() => {
    for (const { marker, id } of markers.current) {
      const el = marker.getElement()
      const inner = el.firstElementChild as HTMLElement | null
      if (!inner) continue
      if (id === hoveredId) {
        // Scale/recolor the inner element (MapTiler doesn't touch it).
        inner.style.transform = "scale(1.3)"
        inner.style.backgroundColor = inner.dataset.hoverColor ?? BRAND.crimsonStrong
        // zIndex on the outer element is safe — MapTiler doesn't set it.
        el.style.zIndex = "10"
      } else {
        inner.style.transform = "scale(1)"
        inner.style.backgroundColor = inner.dataset.baseColor ?? BRAND.crimson
        el.style.zIndex = ""
      }
    }
  }, [hoveredId])

  // Highlight the competitor pin matching the hovered list row.
  useEffect(() => {
    for (const { marker, id } of competitorMarkers.current) {
      const el = marker.getElement()
      const inner = el.firstElementChild as HTMLElement | null
      if (!inner) continue
      if (id === hoveredId) {
        inner.style.transform = "rotate(45deg) scale(1.35)"
        el.style.zIndex = "6"
      } else {
        inner.style.transform = "rotate(45deg)"
        el.style.zIndex = ""
      }
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

      for (const c of valid) {
        const el = competitorMarkerEl(c)
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
          inner.style.transform = "rotate(45deg) scale(1.25)"
          el.style.zIndex = "5"
          onHover(c.googlePlaceId)
        })
        el.addEventListener("mouseleave", () => {
          inner.style.transform = "rotate(45deg)"
          el.style.zIndex = ""
          onHover(null)
        })

        competitorMarkers.current.push({ marker, id: c.googlePlaceId })
      }
    }

    runWhenMapReady(m, mapReady.current, apply)
  }, [competitors, showCompetitors, savedPlaceIds.join(","), onHover])

  // Unlisted Hello Sugar locations: a third marker layer of solid slate dots.
  // Hover previews a non-PII popup; a single click pins it open (click elsewhere
  // on the map dismisses it via closeOnClick). These never navigate and have no
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

        const el = document.createElement("div")
        el.dataset.hsLocationId = loc.id

        const inner = document.createElement("div")
        inner.style.cssText = `
          width: 16px;
          height: 16px;
          background-color: ${isMine ? BRAND.success : BRAND.taupe};
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          transition: transform 0.15s ease;
        `
        el.appendChild(inner)

        const popup = new maptilersdk.Popup({
          offset: 20,
          closeButton: false,
          maxWidth: "220px",
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
        // Owned dots navigate to the owner detail page; everyone else's keep
        // the pin-the-popup behavior. stopPropagation (both paths) keeps the
        // map's closeOnClick from immediately dismissing a pinned popup.
        el.addEventListener("click", (e) => {
          e.stopPropagation()
          if (isMine && onHsLocationClickRef.current) {
            popup.remove()
            onHsLocationClickRef.current(loc.id)
            return
          }
          pinned = true
          popup.addTo(m)
        })
        popup.on("close", () => {
          pinned = false
        })

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

  return (
    <div ref={mapContainer} className="h-full w-full" />
  )
}
