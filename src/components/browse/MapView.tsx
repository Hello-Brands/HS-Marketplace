"use client"

import { useEffect, useRef } from "react"
import * as maptilersdk from "@maptiler/sdk"
import "@maptiler/sdk/dist/maptiler-sdk.css"
import type { ListingCard } from "@/lib/listings-query"

interface MapViewProps {
  listings: ListingCard[]
  hoveredId: string | null
  onHover: (id: string | null) => void
  onListingClick: (id: string) => void
  center?: { lng: number; lat: number } | null
  radiusMiles?: number | null
}

function formatPrice(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}k`
  return `$${dollars.toLocaleString()}`
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

export function MapView({ listings, hoveredId, onHover, onListingClick, center, radiusMiles }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maptilersdk.Map | null>(null)
  const markers = useRef<{ marker: maptilersdk.Marker; id: string }[]>([])
  const mapReady = useRef(false)
  const centerMarker = useRef<maptilersdk.Marker | null>(null)
  // Latest click handler, read inside marker listeners without making it a
  // dependency of the marker effect (keeps the effect from rebuilding markers).
  const onListingClickRef = useRef(onListingClick)
  onListingClickRef.current = onListingClick

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

      const validListings = listings.filter(
        (l) => l.latitude !== null && l.longitude !== null
      )

      for (const listing of validListings) {
        // Outer element is positioned by MapTiler — it rewrites `transform`
        // (translate) every frame. We must NOT set its transform or give it a
        // CSS transition, or markers detach from the map (jump to 0,0 / lag
        // behind while panning). All visuals + hover animation live on `inner`.
        const el = document.createElement("div")
        el.dataset.listingId = listing.id

        const inner = document.createElement("div")
        inner.className = "map-marker"
        inner.style.cssText = `
          width: 16px;
          height: 16px;
          background-color: #db2777;
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
            ${listing.primaryPhotoUrl ? `<img src="${listing.primaryPhotoUrl}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:6px;margin-bottom:8px;" />` : ""}
            <div style="font-size:16px;font-weight:600;color:#111;">${formatPrice(listing.askingPrice)}</div>
            <div style="font-size:13px;color:#6b7280;">${[listing.city, listing.state].filter(Boolean).join(", ") || "Location not specified"}</div>
            <div style="margin-top:6px;">
              <span style="font-size:11px;font-weight:500;background:#fce7f3;color:#9d174d;padding:2px 8px;border-radius:999px;">${listing.type.charAt(0).toUpperCase() + listing.type.slice(1)}</span>
            </div>
            <div style="margin-top:8px;font-size:13px;color:#db2777;font-weight:500;">Click to view details →</div>
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

    if (mapReady.current) {
      addMarkers()
    } else {
      map.current.once("load", addMarkers)
    }
  }, [listings, onHover])

  // Highlight hovered marker
  useEffect(() => {
    for (const { marker, id } of markers.current) {
      const el = marker.getElement()
      const inner = el.firstElementChild as HTMLElement | null
      if (!inner) continue
      if (id === hoveredId) {
        // Scale/recolor the inner element (MapTiler doesn't touch it).
        inner.style.transform = "scale(1.3)"
        inner.style.backgroundColor = "#9d174d"
        // zIndex on the outer element is safe — MapTiler doesn't set it.
        el.style.zIndex = "10"
      } else {
        inner.style.transform = "scale(1)"
        inner.style.backgroundColor = "#db2777"
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
            paint: { "fill-color": "#db2777", "fill-opacity": 0.1 },
          })
          m.addLayer({
            id: `${RADIUS_SOURCE}-line`,
            type: "line",
            source: RADIUS_SOURCE,
            paint: { "line-color": "#db2777", "line-width": 2, "line-opacity": 0.85 },
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

    if (mapReady.current) apply()
    else m.once("load", apply)
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

  return (
    <div ref={mapContainer} className="h-full w-full" />
  )
}
