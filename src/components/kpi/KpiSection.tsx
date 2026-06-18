import { Suspense } from 'react'
import { fetchLocationKpi, fetchBundleKpi, fetchLocationRevenue, fetchLocationMembership } from '@/lib/kpi/fetch'
import { aggregateBundleKpi } from '@/lib/kpi/aggregate'
import { buildLocationKpi } from '@/lib/kpi/assemble'
import { KpiCardRow } from './KpiCardRow'
import { BundleKpiSection } from './BundleKpiSection'

interface Location {
  id: string
  name: string
  type: 'suite' | 'flagship' | 'territory'
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
  // Single location
  if (listingType !== 'bundle' && locationId) {
    // Optional base data (internal HS API / dev mock). May be null when that API
    // is unavailable — that must NOT hide the live BigQuery metrics below.
    const kpiData = await fetchLocationKpi(locationId)

    let rev: Awaited<ReturnType<typeof fetchLocationRevenue>> = null
    let mem: Awaited<ReturnType<typeof fetchLocationMembership>> = null
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
    }

    const data = buildLocationKpi(kpiData, rev?.metric ?? null, mem)
    const revenueLive = data.revenue?.source === "bigquery"

    const hasAnyKpi = data.revenue || data.membershipConversion
    if (!hasAnyKpi) return null

    return (
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Performance Data</h2>
        <p className="text-sm text-gray-500 mb-6">
          {revenueLive
            ? "Net Sales and MCR are live from BigQuery (year-to-date)."
            : "Live data not connected for this location."}
        </p>
        <KpiCardRow kpiData={data} />
      </section>
    )
  }

  // Bundle listing
  if (listingType === 'bundle' && bundleLocations?.length) {
    // Filter out territories (they have no KPI data)
    const openLocations = bundleLocations.filter(loc => loc.type !== 'territory')
    const territories = bundleLocations.filter(loc => loc.type === 'territory')

    if (openLocations.length === 0) {
      return null  // No open locations to show KPIs for
    }

    const locationIds = openLocations.map(loc => loc.id)
    const perLocationKpis = await fetchBundleKpi(locationIds)
    const locationCount = Object.keys(perLocationKpis).length

    if (locationCount === 0) {
      return null  // All locations returned null
    }

    const cumulative = { ...aggregateBundleKpi(perLocationKpis), newClients: undefined, bookings: undefined }
    const hasAnyKpi = cumulative.revenue || cumulative.membershipConversion
    if (!hasAnyKpi) return null

    return (
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Performance Data ({locationCount} locations)
        </h2>
        <p className="text-sm text-gray-500 mb-6">Live per-location data coming soon.</p>

        {/* Cumulative KPI cards */}
        <KpiCardRow kpiData={cumulative} />

        {/* Per-location breakdown */}
        <BundleKpiSection
          locations={openLocations}
          perLocationKpis={perLocationKpis}
          territories={territories}
        />
      </section>
    )
  }

  return null
}
