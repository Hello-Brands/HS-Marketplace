'use client'

import { useEffect, useRef } from 'react'
import type { Map } from '@maptiler/sdk'

interface DetailMapProps {
  latitude: number | null
  longitude: number | null
  locationName: string | null
}

export function DetailMap({ latitude, longitude, locationName }: DetailMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)

  useEffect(() => {
    if (!latitude || !longitude || !containerRef.current || mapRef.current) return

    // Dynamic import to avoid SSR issues
    import('@maptiler/sdk').then(maptilersdk => {
      import('@maptiler/sdk/dist/maptiler-sdk.css' as string).catch(() => {
        // CSS import may fail in some environments; map will still render
      })

      if (!containerRef.current) return

      const apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY
      if (!apiKey) return

      maptilersdk.config.apiKey = apiKey

      const map = new maptilersdk.Map({
        container: containerRef.current,
        style: maptilersdk.MapStyle.STREETS,
        center: [longitude, latitude],
        zoom: 12,
        scrollZoom: false,
        interactive: false,
      })

      map.on('load', () => {
        new maptilersdk.Marker()
          .setLngLat([longitude, latitude])
          .addTo(map)
      })

      mapRef.current = map
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [latitude, longitude])

  if (!latitude || !longitude) {
    return (
      <div className="border border-gray-200 rounded-xl p-4 bg-gray-50 flex items-center justify-center h-[200px]">
        <p className="text-gray-400 text-sm">Location not available</p>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {locationName && (
        <div className="px-4 py-2 border-b border-gray-200 bg-white">
          <p className="text-sm font-medium text-gray-700">{locationName}</p>
        </div>
      )}
      <div ref={containerRef} style={{ height: '200px', width: '100%' }} />
    </div>
  )
}
