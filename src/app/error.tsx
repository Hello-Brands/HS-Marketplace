"use client"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-6 sm:p-8 text-center">
        <img
          src="/hs-logo-drop.png"
          alt="Hello Sugar"
          className="h-12 w-auto mx-auto mb-6"
        />
        <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
        <p className="mt-3 text-gray-600">
          This page hit an unexpected error. You can try again, and if it keeps
          happening, email{" "}
          <a
            href="mailto:marketplace@hellosugar.salon"
            className="text-hs-red-600 hover:text-hs-red-700 underline underline-offset-2"
          >
            marketplace@hellosugar.salon
          </a>
          .
        </p>
        {error.digest && (
          <p className="mt-2 text-sm text-gray-500">Reference code: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-[44px] items-center justify-center bg-hs-red-600 hover:bg-hs-red-700 text-white rounded-full px-7 py-3 text-base font-semibold transition-colors"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
