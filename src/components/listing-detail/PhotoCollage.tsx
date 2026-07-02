import Image from 'next/image'

interface Photo {
  id: string
  url: string
}

interface PhotoCollageProps {
  photos: Photo[]
  onShowAll: () => void
  onPhotoClick?: (index: number) => void
}

export function PhotoCollage({ photos, onShowAll, onPhotoClick }: PhotoCollageProps) {
  if (photos.length === 0) {
    return (
      <div className="h-[300px] md:h-[500px] rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center">
        <p className="text-gray-400">No photos available</p>
      </div>
    )
  }

  const primary = photos[0]
  const secondary = photos.slice(1, 5) // up to 4 additional photos

  // If only 1 photo, show it full-width
  if (photos.length === 1) {
    return (
      <div className="relative h-[300px] md:h-[500px] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => onPhotoClick?.(0)}
          className="absolute inset-0 w-full h-full cursor-pointer focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-inset"
          aria-label="View photo fullscreen"
        >
          <Image
            src={primary.url}
            alt="Listing photo"
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 1152px"
            priority
          />
        </button>
        <button
          onClick={onShowAll}
          className="absolute bottom-4 right-4 bg-white border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2 min-h-[44px]"
        >
          Show all photos
        </button>
      </div>
    )
  }

  // 2+ photos: hero on the left half, the remaining photos fill the right half.
  // The right cluster's grid adapts to how many photos remain so there are never
  // empty/placeholder tiles: 1 → single, 2 → stacked, 3 → stacked, 4+ → 2×2.
  const rightGridClass =
    secondary.length === 4
      ? 'grid-cols-2 grid-rows-2'
      : secondary.length === 3
        ? 'grid-rows-3'
        : secondary.length === 2
          ? 'grid-rows-2'
          : 'grid-rows-1'

  return (
    <div className="relative">
      <div className="flex gap-2 h-[250px] md:h-[500px] rounded-xl overflow-hidden">
        {/* Hero photo — left half on desktop, full width on mobile */}
        <button
          type="button"
          onClick={() => onPhotoClick?.(0)}
          className="relative w-full md:w-1/2 cursor-pointer group/photo focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-inset"
          aria-label="View primary photo fullscreen"
        >
          <Image
            src={primary.url}
            alt="Primary listing photo"
            fill
            className="object-cover group-hover/photo:scale-[1.02] transition-transform duration-300"
            sizes="(max-width: 768px) 100vw, 576px"
            priority
          />
        </button>

        {/* Remaining photos — right half, hidden on mobile. Grid sized to the count. */}
        <div className={`hidden md:grid md:w-1/2 gap-2 ${rightGridClass}`}>
          {secondary.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => onPhotoClick?.(i + 1)}
              className="relative cursor-pointer group/photo focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-inset"
              aria-label={`View photo ${i + 2} fullscreen`}
            >
              <Image
                src={photo.url}
                alt={`Listing photo ${i + 2}`}
                fill
                className="object-cover group-hover/photo:scale-[1.03] transition-transform duration-300"
                sizes="(max-width: 768px) 25vw, 288px"
              />
              {/* Dim overlay on the last tile when more photos exist beyond it */}
              {i === secondary.length - 1 && photos.length > 5 && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
                  <span className="text-white font-semibold text-lg">+{photos.length - 5}</span>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onShowAll}
        className="absolute bottom-4 right-4 bg-white border border-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shadow-sm focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2 min-h-[44px]"
      >
        Show all photos
      </button>
    </div>
  )
}
