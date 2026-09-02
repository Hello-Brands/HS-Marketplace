import Link from "next/link"
import { Suspense } from "react"

// NextAuth error codes that indicate system issues (not access denial),
// mapped to plain-language explanations of what actually happened.
const SYSTEM_ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: "We couldn't start the Google sign-in request.",
  OAuthCallback: "Google didn't finish handing your sign-in back to us.",
  OAuthCreateAccount: "Your Google sign-in worked, but we couldn't create your account.",
  Callback: "Sign-in was interrupted before it finished.",
  OAuthAccountNotLinked: "This email address is already connected to a different sign-in method.",
  SessionRequired: "Your session ended, so you need to sign in again to view that page.",
  Default: "Sign-in failed for an unexpected reason.",
  Configuration: "Sign-in is misconfigured on our end. This is not a problem with your account.",
  // Magic-link (email provider) failures.
  Verification:
    "This sign-in link has expired or was already used. Request a new one from the sign-in page.",
  EmailSignin: "We couldn't send the sign-in email. Please try again in a moment.",
  EmailCreateAccount:
    "We couldn't finish creating your account from the sign-in link. Please try again.",
}
const SYSTEM_ERRORS = Object.keys(SYSTEM_ERROR_MESSAGES)

// Codes whose default "Authentication Error" heading and "Try a different
// account" link would misdescribe what happened. An expired magic link is not
// an account problem — the fix is a fresh link from /login.
const SYSTEM_ERROR_OVERRIDES: Record<string, { heading: string; cta: string }> = {
  Verification: { heading: "Link expired", cta: "Request a new sign-in link" },
}

interface AccessDeniedPageProps {
  searchParams: Promise<{ error?: string }>
}

async function AccessDeniedContent({ searchParams }: AccessDeniedPageProps) {
  const params = await searchParams
  const error = params.error
  const isSystemError = error && SYSTEM_ERRORS.includes(error)
  const override = error ? SYSTEM_ERROR_OVERRIDES[error] : undefined

  return (
    <div className="w-full max-w-md space-y-6 text-center">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {isSystemError
            ? (override?.heading ?? "Authentication Error")
            : "Access Required"}
        </h1>
        {isSystemError ? (
          <div className="mt-4 space-y-2">
            <p className="text-gray-600">
              {SYSTEM_ERROR_MESSAGES[error]}
            </p>
            <p className="text-sm text-hs-red-600 bg-hs-red-50 rounded px-3 py-2">
              Error code: {error}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-gray-600">
            The Hello Sugar Marketplace is for franchise owners and approved partners.
          </p>
        )}
      </div>

      {isSystemError ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            This may be a temporary issue. Please try signing in again, or contact{" "}
            <a href="mailto:marketplace@hellosugar.salon" className="text-hs-red-600 hover:text-hs-red-700 underline underline-offset-2">
              marketplace@hellosugar.salon
            </a>{" "}
            if the problem persists.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            If you believe you should have access, please contact your franchise representative or email{" "}
            <a href="mailto:marketplace@hellosugar.salon" className="text-hs-red-600 hover:text-hs-red-700 underline underline-offset-2">
              marketplace@hellosugar.salon
            </a>
          </p>

          <div className="pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-500 mb-3">
              Interested in becoming a Hello Sugar franchisee?
            </p>
            <Link
              href="https://www.hellosugar.salon/franchise"
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-hs-red-600 px-6 py-3 text-base text-white font-semibold hover:bg-hs-red-700 transition-colors"
            >
              Learn About Franchising
            </Link>
          </div>
        </div>
      )}

      <Link href="/login" className="text-sm text-hs-red-600 hover:text-hs-red-700 underline underline-offset-2">
        {override?.cta ?? "Try a different account"}
      </Link>
    </div>
  )
}

function AccessDeniedFallback() {
  return (
    <div className="w-full max-w-md flex justify-center py-16" role="status" aria-label="Loading">
      <svg className="h-8 w-8 animate-spin text-hs-red-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
    </div>
  )
}

export default function AccessDeniedPage({ searchParams }: AccessDeniedPageProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-12">
      <Suspense fallback={<AccessDeniedFallback />}>
        <AccessDeniedContent searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
