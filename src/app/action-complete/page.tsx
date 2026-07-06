import Link from 'next/link'

export default async function ActionCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; message?: string }>
}) {
  // In Next.js 15+, searchParams is a Promise
  const resolvedParams = await searchParams
  const success = resolvedParams.success === 'true'
  const message = resolvedParams.message || (success ? 'Action completed' : 'Action failed')

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8 text-center">
        <div className={`
          inline-flex items-center justify-center w-16 h-16 rounded-full mb-6
          ${success ? 'bg-green-100' : 'bg-hs-red-100'}
        `}>
          {success ? (
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-hs-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>

        <h1 className={`text-xl font-bold mb-2 ${success ? 'text-gray-900' : 'text-hs-red-900'}`}>
          {success ? 'Success' : 'Action Failed'}
        </h1>
        <p className="text-gray-600 mb-6">{message}</p>

        <Link
          href="/seller/listings"
          className="inline-flex min-h-[44px] items-center justify-center px-6 py-3 bg-hs-red-600 text-white rounded-full text-base font-semibold hover:bg-hs-red-700 transition-colors"
        >
          Go to My Listings
        </Link>
      </div>
    </div>
  )
}
