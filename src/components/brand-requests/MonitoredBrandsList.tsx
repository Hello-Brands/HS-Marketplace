import {
  formatBrandChipLabel,
  monitoredCountLabel,
} from "@/lib/brand-requests/monitored-brands-display"

type MonitoredBrandChip = {
  brandId: string
  name: string
  locationsCount: number | null
}

/**
 * Reference list of brands the competitor monitor already scrapes.
 *
 * Deliberately SUBORDINATE to "My requests" on the hub page: small muted
 * heading, one quiet card, non-interactive chips. It answers "is my brand
 * already covered?" before someone files a duplicate request — it is not a
 * call to action, so nothing here is clickable or hoverable.
 *
 * Caller is responsible for ordering (see sortMonitoredBrands).
 */
export function MonitoredBrandsList({ brands }: { brands: MonitoredBrandChip[] }) {
  return (
    <section aria-labelledby="monitored-brands-heading">
      <div className="flex flex-wrap items-baseline gap-x-2 mb-2">
        <h3
          id="monitored-brands-heading"
          className="text-sm font-semibold text-hs-taupe"
        >
          Brands we&apos;re already monitoring
        </h3>
        <span className="text-xs text-gray-500">
          {monitoredCountLabel(brands.length)}
        </span>
      </div>

      <div className="p-4 bg-white rounded-xl border border-gray-200">
        {brands.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            No brands are being monitored yet.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {brands.map((brand) => (
              <li
                key={brand.brandId}
                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs sm:text-sm text-gray-700"
              >
                {formatBrandChipLabel(brand.name, brand.locationsCount)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
