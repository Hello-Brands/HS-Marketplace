'use client'

import dynamic from 'next/dynamic'
import { useState, useCallback, useEffect } from 'react'
import { EXISTING_HS_LOCATIONS } from '@/lib/listings/mock-data'

// Dynamic imports for SSR compatibility
const MapContainer = dynamic(
  () => import('react-leaflet').then(m => m.MapContainer),
  { ssr: false }
)
const TileLayer = dynamic(
  () => import('react-leaflet').then(m => m.TileLayer),
  { ssr: false }
)
const Circle = dynamic(
  () => import('react-leaflet').then(m => m.Circle),
  { ssr: false }
)
const Marker = dynamic(
  () => import('react-leaflet').then(m => m.Marker),
  { ssr: false }
)
const Popup = dynamic(
  () => import('react-leaflet').then(m => m.Popup),
  { ssr: false }
)
const MapClickHandler = dynamic(
  () => import('./MapClickHandler'),
  { ssr: false }
)

interface TerritoryPickerProps {
  value?: { center: { lat: number; lng: number }; radius: number }
  onChange: (value: { center: { lat: number; lng: number }; radius: number }) => void
  territoryName: string
  onNameChange: (name: string) => void
}

export function TerritoryPicker({
  value,
  onChange,
  territoryName,
  onNameChange,
}: TerritoryPickerProps) {
  const [isClient, setIsClient] = useState(false)
  const [center, setCenter] = useState(value?.center || { lat: 33.749, lng: -84.388 })
  const [radius, setRadius] = useState(value?.radius || 8000) // 8km default

  useEffect(() => {
    setIsClient(true)
    // Load Leaflet CSS
    if (typeof window !== 'undefined') {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      document.head.appendChild(link)
    }
  }, [])

  const handleMapClick = useCallback((latlng: { lat: number; lng: number }) => {
    const newCenter = { lat: latlng.lat, lng: latlng.lng }
    setCenter(newCenter)
    onChange({ center: newCenter, radius })
  }, [radius, onChange])

  const handleRadiusChange = useCallback((newRadius: number) => {
    setRadius(newRadius)
    onChange({ center, radius: newRadius })
  }, [center, onChange])

  if (!isClient) {
    return <div className="h-96 bg-gray-100 rounded-lg animate-pulse" />
  }

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
          <MapContainer
            center={[center.lat, center.lng]}
            zoom={10}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />

            <MapClickHandler onMapClick={handleMapClick} />

            {/* Existing Hello Sugar locations as context */}
            {EXISTING_HS_LOCATIONS.map((loc, i) => (
              <Marker key={i} position={[loc.lat, loc.lng]}>
                <Popup>{loc.name}</Popup>
              </Marker>
            ))}

            {/* Territory circle */}
            <Circle
              center={[center.lat, center.lng]}
              radius={radius}
              pathOptions={{ color: '#ED1845', fillOpacity: 0.2 }}
            />
          </MapContainer>
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
