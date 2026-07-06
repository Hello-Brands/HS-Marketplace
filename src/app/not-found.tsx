import Link from "next/link"

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sm:p-8 text-center">
        <img
          src="/hs-logo-drop.png"
          alt="Hello Sugar"
          className="h-12 w-auto mx-auto mb-6"
        />
        <h1 className="text-2xl font-bold text-gray-900">Page not found</h1>
        <p className="mt-3 text-gray-600">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Link
          href="/browse"
          className="mt-6 inline-flex min-h-[44px] items-center justify-center bg-hs-red-600 hover:bg-hs-red-700 text-white rounded-full px-7 py-3 text-base font-semibold transition-colors"
        >
          Browse listings
        </Link>
      </div>
    </main>
  )
}
