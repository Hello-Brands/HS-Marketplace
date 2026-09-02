import Link from "next/link"

/**
 * Auth.js `verifyRequest` landing page: where the email provider sends the
 * browser after it hands the magic link to Resend. Reached with NO session, so
 * it is listed in PUBLIC_PATHS (src/lib/auth-public-paths.ts).
 *
 * Deliberately static — it never echoes the submitted address, which would leak
 * whether an email is registered to anyone who can craft the URL.
 */
export default function CheckEmailPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-12">
      <div className="w-full max-w-md space-y-6 text-center">
        <img
          src="/hs-logo-stacked-color.png"
          alt="Hello Sugar"
          className="mx-auto h-20 w-auto"
        />

        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-hs-red-100">
          <svg
            className="h-6 w-6 text-hs-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>

        <div className="space-y-3">
          <h1 className="text-display-lg text-gray-900">Check your email</h1>
          <p className="text-gray-500">
            We sent you a sign-in link. It expires in 15 minutes and works once.
          </p>
          <p className="text-gray-500">
            If it hasn&apos;t arrived in a couple of minutes, check your spam folder or
            request a new link.
          </p>
        </div>

        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-hs-red-600 px-6 py-3 text-base text-white font-semibold hover:bg-hs-red-700 transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  )
}
