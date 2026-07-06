import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { ListingDisclaimerGate } from '@/components/listings/ListingDisclaimerGate'

export default async function NewListingPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect('/login')
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">List your location for sale</h1>
      <p className="text-gray-500 mb-6">
        Financial data is pulled automatically from Hello Sugar -- buyers see verified numbers, not estimates.
      </p>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
        <ListingDisclaimerGate userId={session.user.id} />
      </div>
    </div>
  )
}
