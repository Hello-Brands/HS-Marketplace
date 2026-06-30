import { auth } from '@/auth'
import { redirect, notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getListingById } from '@/lib/listing-detail'
import { recordListingView } from '@/lib/analytics/views'
import { hasContactedListing } from '@/lib/contact-actions'
import { isFavorited } from '@/lib/favorites-actions'
import { ListingPhotos } from './ListingPhotos'
import { ContactForm } from './ContactForm'
import { FavoriteButtonLarge } from './FavoriteButtonLarge'
import { ShareButton } from './ShareButton'
import { FinancialsGrid } from '@/components/listing-detail/FinancialsGrid'
import { DetailMap } from '@/components/listing-detail/DetailMap'
import { KpiSection } from '@/components/kpi/KpiSection'
import { FloatingContactCta } from '@/components/listing-detail/FloatingContactCta'
import { StatStrip } from '@/components/listing-detail/StatStrip'
import { SiteHeader } from '@/components/layout/SiteHeader'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const listing = await getListingById(id)
  if (!listing) return { title: 'Listing Not Found' }

  const primaryLocation = listing.locations[0]
  const displayName = listing.title || primaryLocation?.name || `${primaryLocation?.city}, ${primaryLocation?.state}`

  return {
    title: `${displayName} - Hello Sugar Marketplace`,
    description: `${listing.type} listing${primaryLocation?.city ? ` in ${primaryLocation.city}, ${primaryLocation.state}` : ''}`,
  }
}

export default async function ListingDetailPage({ params }: Props) {
  const { id } = await params

  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  const listing = await getListingById(id)
  if (!listing) {
    notFound()
  }

  await recordListingView(listing.id)

  const [contacted, favorited] = await Promise.all([
    hasContactedListing(listing.id),
    isFavorited(listing.id),
  ])

  // Primary salon location for display
  const primaryLocation = listing.locations.find(l => l.locationType === 'salon') ?? listing.locations[0]

  // Coordinates for map (first salon location with coords)
  const mapLocation = listing.locations.find(
    l => l.locationType === 'salon' || (l.territoryLat != null && l.territoryLng != null)
  )
  const mapLat = mapLocation?.locationType === 'territory'
    ? mapLocation.territoryLat
    : null
  const mapLng = mapLocation?.locationType === 'territory'
    ? mapLocation.territoryLng
    : null

  const displayName =
    listing.title ||
    primaryLocation?.name ||
    [primaryLocation?.city, primaryLocation?.state].filter(Boolean).join(', ') ||
    'Listing'

  const photos = listing.photos.map(p => ({ id: p.id, url: p.url }))

  return (
    <>
      <SiteHeader world="marketplace" title={displayName} />
      <main className="max-w-7xl mx-auto px-4 py-4 sm:py-8 pb-24 sm:pb-8">
      {/* Photo Gallery */}
      <ListingPhotos photos={photos} />

      {/* Header: Name, Type Badge, Location, Actions */}
      <div className="mt-4 sm:mt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block px-3 py-1.5 text-sm font-medium bg-hs-red-100 text-hs-red-800 rounded-lg capitalize">
                {listing.type}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded-lg">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified by Hello Sugar
              </span>
            </div>
            <h1 className="text-display-lg mt-2 text-gray-900">{displayName}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0 pt-1">
            <ShareButton listingName={displayName} />
            <FavoriteButtonLarge listingId={listing.id} initialFavorited={favorited} />
          </div>
        </div>
        {listing.locations.length > 0 && (
          <div className="mt-1 space-y-1.5">
            {listing.locations.map(loc => {
              const cityState = [loc.city, loc.state].filter(Boolean).join(', ')
              return (
                <div key={loc.id} className="text-gray-600">
                  <p>
                    {loc.name}
                    {loc.squareFootage ? ` · ${loc.squareFootage.toLocaleString()} sq ft` : ''}
                    {loc.openingDate ? ` · Opened ${new Date(loc.openingDate).getFullYear()}` : ''}
                  </p>
                  {(loc.address || cityState) && (
                    <p className="text-sm text-gray-500">{loc.address ?? cityState}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <StatStrip
          listedAt={listing.listedAt}
          createdAt={listing.createdAt}
          viewCount={listing.viewCount}
          savesCount={listing.savesCount}
        />
      </div>

      {/* Two column layout on desktop */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content - 2 cols */}
        <div className="lg:col-span-2 space-y-8">
          {/* Financials */}
          <section>
            <h2 className="text-xl font-display font-semibold mb-4 text-gray-900">Financials</h2>
            <FinancialsGrid listing={listing} />
          </section>

          {/* Live KPI Section */}
          <KpiSection
            listingType={listing.type}
            locationId={
              listing.type !== 'bundle' && listing.type !== 'territory'
                ? (listing.locations.find(l => l.locationType === 'salon') ?? listing.locations[0])?.id
                : undefined
            }
            bundleLocations={
              listing.type === 'bundle'
                ? listing.locations.map(loc => ({
                    id: loc.id,
                    name: loc.name,
                    type: loc.locationType === 'territory' ? 'territory' : 'suite',
                  }))
                : undefined
            }
            bqLocationName={primaryLocation?.bqLocationName ?? null}
            dataMappingStatus={primaryLocation?.dataMappingStatus}
            listingStatus={listing.status}
          />

          {/* About / Notes */}
          {listing.notes && (
            <section>
              <h2 className="text-xl font-display font-semibold mb-4 text-gray-900">About This Location</h2>
              <p className="text-gray-700 whitespace-pre-wrap">{listing.notes}</p>
            </section>
          )}

          {/* Reason for Selling */}
          {listing.reasonForSelling && (
            <section>
              <h2 className="text-xl font-display font-semibold mb-4 text-gray-900">Reason for Selling</h2>
              <p className="text-gray-700">{listing.reasonForSelling}</p>
            </section>
          )}
        </div>

        {/* Sidebar - 1 col */}
        <div className="space-y-6">
          {/* Sticky Contact Form Card — desktop only */}
          <div className="hidden lg:block sticky top-4">
            <div className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-4">Contact Seller</h3>
              <ContactForm
                listingId={listing.id}
                buyerName={session.user.name ?? null}
                buyerEmail={session.user.email ?? null}
                hasContacted={contacted}
              />
            </div>
          </div>

          {/* Map — only shown for territory listings which have lat/lng */}
          {mapLat && mapLng && (
            <DetailMap
              latitude={mapLat}
              longitude={mapLng}
              locationName={primaryLocation?.name ?? null}
            />
          )}

          {/* Location details card */}
          {listing.locations.length > 0 && (
            <div className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
              <h3 className="font-semibold text-gray-900">Location Details</h3>
              {listing.locations.map(loc => (
                <div key={loc.id} className="text-sm text-gray-600 space-y-1">
                  <p className="font-medium text-gray-800">{loc.name}</p>
                  {loc.address && <p>{loc.address}</p>}
                  {loc.city && <p>{loc.city}, {loc.state} {loc.zipCode}</p>}
                  {loc.squareFootage && <p>{loc.squareFootage.toLocaleString()} sq ft</p>}
                  {loc.openingDate && (
                    <p>Opened {new Date(loc.openingDate).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Floating Contact CTA — mobile only */}
      <FloatingContactCta />

      {/* Contact Form Section — mobile fallback (hidden on desktop) */}
      <section id="contact" className="lg:hidden mt-12 pt-8 border-t border-gray-200">
        <h2 className="text-xl font-display font-semibold mb-4 text-gray-900">Contact Seller</h2>
        <div className="max-w-md">
          <ContactForm
            listingId={listing.id}
            buyerName={session.user.name ?? null}
            buyerEmail={session.user.email ?? null}
            hasContacted={contacted}
          />
        </div>
      </section>
      </main>
    </>
  )
}
