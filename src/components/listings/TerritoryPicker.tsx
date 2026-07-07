'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as maptilersdk from '@maptiler/sdk'
import '@maptiler/sdk/dist/maptiler-sdk.css'
import { EXISTING_HS_LOCATIONS } from '@/lib/listings/mock-data'
import { BRAND } from '@/lib/brand-colors'
import { escapeHtml } from '@/lib/escape-html'

interface TerritoryPickerProps {
  value?: { center: { lat: number; lng: number }; radius: number }
  onChange: (value: { center: { lat: number; lng: number }; radius: number }) => void
  territoryName: string
  onNameChange: (name: string) => void
}

const TERRITORY_SOURCE = 'territory-circle'

// Approximate a ground circle (radius in METERS) as a lat/lng polygon for the
// territory overlay. Mirrors MapView's circlePolygon, but metric — the wizard's
// radius value is stored in meters, not miles.
function circlePolygonMeters(
  lng: number,
  lat: number,
  radiusMeters: number,
  points = 64
): GeoJSON.Feature {
  const latR = radiusMeters / 111320
  const lngR = radiusMeters / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01))
  const ring: [number, number][] = []
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * 2 * Math.PI
    ring.push([lng + lngR * Math.cos(t), lat + latR * Math.sin(t)])
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  }
}

export function TerritoryPicker({
  value,
  onChange,
  territoryName,
  onNameChange,
}: TerritoryPickerProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maptilersdk.Map | null>(null)
  const mapReady = useRef(false)

  const [center, setCenter] = useState(value?.center || { lat: 33.749, lng: -84.388 })
  const [radius, setRadius] = useState(value?.radius || 8000) // 8km default

  // Keep the latest center/radius readable inside the (once-bound) map click
  // handler without making the init effect depend on them.
  const centerRef = useRef(center)
  centerRef.current = center
  const radiusRef = useRef(radius)
  radiusRef.current = radius
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const handleRadiusChange = useCallback(
    (newRadius: number) => {
      setRadius(newRadius)
      onChangeRef.current({ center: centerRef.current, radius: newRadius })
    },
    []
  )

  // Initialize the map once and wire up click-to-set-center + HS location pins.
  useEffect(() => {
    if (map.current || !mapContainer.current) return

    maptilersdk.config.apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY!

    map.current = new maptilersdk.Map({
      container: mapContainer.current,
      style: maptilersdk.MapStyle.STREETS,
      center: [centerRef.current.lng, centerRef.current.lat],
      zoom: 10,
    })

    // Click to place the territory center.
    map.current.on('click', (e) => {
      const newCenter = { lat: e.lngLat.lat, lng: e.lngLat.lng }
      setCenter(newCenter)
      onChangeRef.current({ center: newCenter, radius: radiusRef.current })
    })

    map.current.on('load', () => {
      mapReady.current = true

      // Existing Hello Sugar locations as read-only context pins.
      for (const loc of EXISTING_HS_LOCATIONS) {
        const el = document.createElement('div')
        const inner = document.createElement('div')
        inner.style.cssText = `
          width: 14px;
          height: 14px;
          background-color: ${BRAND.taupe};
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        `
        el.appendChild(inner)

        const popup = new maptilersdk.Popup({
          offset: 18,
          closeButton: false,
          maxWidth: '220px',
        }).setHTML(
          `<div style="font-family:'Montserrat',system-ui,sans-serif;font-size:13px;font-weight:600;color:${BRAND.ink};padding:2px 4px;">${escapeHtml(loc.name)}</div>`
        )

        new maptilersdk.Marker({ element: el })
          .setLngLat([loc.lng, loc.lat])
          .setPopup(popup)
          .addTo(map.current!)
      }
    })

    return () => {
      map.current?.remove()
      map.current = null
      mapReady.current = false
    }
  }, [])

  // Draw / update the territory circle whenever center or radius changes.
  useEffect(() => {
    const m = map.current
    if (!m) return

    const apply = () => {
      const data = circlePolygonMeters(center.lng, center.lat, radius)
      const existing = m.getSource(TERRITORY_SOURCE) as
        | maptilersdk.GeoJSONSource
        | undefined
      if (existing) {
        existing.setData(data)
      } else {
        m.addSource(TERRITORY_SOURCE, { type: 'geojson', data })
        m.addLayer({
          id: `${TERRITORY_SOURCE}-fill`,
          type: 'fill',
          source: TERRITORY_SOURCE,
          paint: { 'fill-color': BRAND.crimson, 'fill-opacity': 0.2 },
        })
        m.addLayer({
          id: `${TERRITORY_SOURCE}-line`,
          type: 'line',
          source: TERRITORY_SOURCE,
          paint: { 'line-color': BRAND.crimson, 'line-width': 2, 'line-opacity': 0.85 },
        })
      }
    }

    if (mapReady.current) apply()
    else m.once('load', apply)
  }, [center, radius])

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="territoryName" className="block text-sm font-medium text-gray-700 mb-1">
          Territory Name
        </label>
        <input
          id="territoryName"
          type="text"
          value={territoryName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., North Atlanta Territory"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-hs-red-500 focus:border-hs-red-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Territory Area
        </label>
        <p className="text-sm text-gray-500 mb-2">
          Click on the map to set the center, then adjust the radius.
        </p>
        <div className="h-96 rounded-lg overflow-hidden border border-gray-200">
          <div ref={mapContainer} className="h-full w-full" />
        </div>
      </div>

      <div>
        <label htmlFor="territoryRadius" className="block text-sm font-medium text-gray-700 mb-1">
          Radius: {(radius / 1000).toFixed(1)} km ({(radius / 1609).toFixed(1)} mi)
        </label>
        <input
          id="territoryRadius"
          type="range"
          min={1000}
          max={50000}
          step={500}
          value={radius}
          onChange={(e) => handleRadiusChange(Number(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-hs-red-600"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>1 km</span>
          <span>50 km</span>
        </div>
      </div>
    </div>
  )
}
