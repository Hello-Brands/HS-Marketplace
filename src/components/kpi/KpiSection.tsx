import { Suspense } from 'react'
import { fetchLocationKpi, fetchBundleKpi, fetchLocationRevenue, fetchLocationMembership } from '@/lib/kpi/fetch'
import { aggregateBundleKpi } from '@/lib/kpi/aggregate'
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
  /** Boulevard location ID for real revenue overlay (single-location only) */
  boulevardLocationId?: string | null
  /** Boulevard mapping status (single-location only) */
  boulevardMappingStatus?: string
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
  boulevardLocationId,
  boulevardMappingStatus,
  listingStatus,
}: KpiSectionProps) {
  // Single location
  if (listingType !== 'bundle' && locationId) {
    const kpiData = await fetchLocationKpi(locationId)
    if (!kpiData) return null

    let data = kpiData
    if (boulevardMappingStatus && listingStatus) {
      const rev = await fetchLocationRevenue({
        listingStatus,
        mappingStatus: boulevardMappingStatus,
        boulevardLocationId: boulevardLocationId ?? null,
      })
      if (rev) data = { ...data, revenue: rev.metric }
      const mem = await fetchLocationMembership({
        listingStatus,
        mappingStatus: boulevardMappingStatus,
        boulevardLocationId: boulevardLocationId ?? null,
      })
      if (mem) data = { ...data, membershipConversion: mem }
    }
    const revenueLive = data.revenue?.source === "boulevard"

    const hasAnyKpi = data.revenue || data.newClients || data.bookings || data.membershipConversion
    if (!hasAnyKpi) return null

    return (
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Performance Data</h2>
        <p className="text-sm text-gray-500 mb-6">
          {revenueLive
            ? "Revenue is live from Boulevard. Other metrics are sample data."
            : "Sample data — Boulevard revenue is not connected for this location."}
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

    const cumulative = aggregateBundleKpi(perLocationKpis)
    const hasAnyKpi = cumulative.revenue || cumulative.newClients || cumulative.bookings || cumulative.membershipConversion
    if (!hasAnyKpi) return null

    return (
      <section className="mt-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Performance Data ({locationCount} locations)
        </h2>
        <p className="text-sm text-gray-500 mb-6">Sample data — live metrics coming soon.</p>

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
