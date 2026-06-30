import { Suspense } from 'react'
import { fetchLocationRevenue, fetchLocationMembership, fetchLocationReviews, fetchBundleLocationKpis } from '@/lib/kpi/fetch'
import { aggregateBundleLocationKpis } from '@/lib/kpi/bundle'
import { LocationKpiCards } from './LocationKpiCards'
import { BundleKpiSection } from './BundleKpiSection'
import { LocationReviewsPanel } from './LocationReviewsPanel'

interface Location {
  id: string
  name: string
  type: 'suite' | 'flagship' | 'territory'
  bqLocationName?: string | null
  dataMappingStatus?: string
}

interface KpiSectionProps {
  /** Single location ID for individual listings */
  locationId?: string
  /** Multiple locations for bundle listings (with names for table) */
  bundleLocations?: Location[]
  /** Listing type - if 'territory', section is hidden */
  listingType: 'suite' | 'flagship' | 'territory' | 'bundle'
  /** BigQuery LOCATION_NAME for real data overlay (single-location only) */
  bqLocationName?: string | null
  /** Data-source mapping status (single-location only) */
  dataMappingStatus?: string
  /** Listing status (single-location only) */
  listingStatus?: string
}

export function KpiSection(props: KpiSectionProps) {
  // Territories have no operational data - hide section entirely
  if (props.listingType === 'territory') {
    return null
  }

  return (
    <Suspense fallback={null}>
      <KpiSectionContent {...props} />
    </Suspense>
  )
}

async function KpiSectionContent({
  locationId,
  bundleLocations,
  listingType,
  bqLocationName,
  dataMappingStatus,
  listingStatus,
}: KpiSectionProps) {
  // Single location — Net Sales + MCR come straight from BigQuery; New Clients
  // and Bookings have no live source, so they are not shown. When a location is
  // not connected we render placeholders rather than hide the section.
  if (listingType !== 'bundle' && locationId) {
    let rev: Awaited<ReturnType<typeof fetchLocationRevenue>> = null
    let mem: Awaited<ReturnType<typeof fetchLocationMembership>> = null
    let reviews: Awaited<ReturnType<typeof fetchLocationReviews>> = null
    if (dataMappingStatus && listingStatus) {
      rev = await fetchLocationRevenue({
        listingStatus,
        mappingStatus: dataMappingStatus,
        bqLocationName: bqLocationName ?? null,
      })
      mem = await fetchLocationMembership({
        listingStatus,
        mappingStatus: dataMappingStatus,
        bqLocationName: bqLocationName ?? null,
      })
      reviews = await fetchLocationReviews({
        listingStatus,
        mappingStatus: dataMappingStatus,
        bqLocationName: bqLocationName ?? null,
      })
    }

    const netSales = rev?.metric ?? null
    const revenueLive = netSales !== null

    return (
      <section className="mt-12">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Performance Data</h2>
          {revenueLive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-lg">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Verified by Hello Sugar
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-6">
          {revenueLive
            ? "Net Sales and MCR are live from BigQuery (trailing 12 months)."
            : "Live data not connected for this location."}
        </p>
        <LocationKpiCards netSales={netSales} membership={mem} />
        <LocationReviewsPanel reviews={reviews} />
      </section>
    )
  }

  // Bundle listing — real BigQuery Net Sales + MCR, aggregate + per-location drill-in.
  if (listingType === 'bundle' && bundleLocations?.length) {
    const openLocations = bundleLocations.filter((loc) => loc.type !== 'territory')
    const territories = bundleLocations.filter((loc) => loc.type === 'territory')

    if (openLocations.length === 0) {
      return null // nothing operational to show
    }

    const perLocation = await fetchBundleLocationKpis(
      openLocations.map((l) => ({
        id: l.id,
        name: l.name,
        bqLocationName: l.bqLocationName ?? null,
        dataMappingStatus: l.dataMappingStatus ?? 'not_connected',
      })),
      listingStatus ?? '',
    )
    const aggregate = aggregateBundleLocationKpis(perLocation)
    const anyLive = perLocation.some((l) => l.netSales || l.membership)

    return (
      <section className="mt-12">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-gray-900">
            Performance Data ({openLocations.length} locations)
          </h2>
          {anyLive && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-lg">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Verified by Hello Sugar
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-6">
          {anyLive
            ? 'Aggregate across the bundle — Net Sales summed, MCR averaged (trailing 12 months). Tap a location for its detail.'
            : 'Live data not connected for these locations.'}
        </p>

        <LocationKpiCards
          netSales={aggregate.netSales}
          membership={aggregate.membership}
          membershipLabel="Membership Conversion (avg.)"
        />

        <BundleKpiSection
          locations={perLocation}
          territories={territories.map((t) => ({ id: t.id, name: t.name }))}
        />
      </section>
    )
  }

  return null
}
