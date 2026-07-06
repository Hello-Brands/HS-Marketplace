import { getPendingListings } from '@/lib/admin/actions'
import { ModerationQueue } from '@/components/admin/ModerationQueue'

export default async function AdminQueuePage() {
  const listings = await getPendingListings()

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-6">
        <h1 className="min-w-0 font-display text-2xl font-bold text-gray-900">Approval Queue</h1>
        <span className="text-sm text-gray-500">
          {listings.length} listing{listings.length !== 1 ? 's' : ''} pending
        </span>
      </div>

      <ModerationQueue listings={listings} />
    </div>
  )
}
