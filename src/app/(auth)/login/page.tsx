import { signIn } from "@/auth"

export default function LoginPage() {
  return (
    <main className="min-h-screen flex">
      {/* Left Panel - Hero */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 bg-hs-red-600">
        {/* Content */}
        <div className="flex flex-col justify-between p-12 xl:p-16">
          {/* Logo */}
          <div>
            <img
              src="/hs-logo-stacked-white.png"
              alt="Hello Sugar"
              className="h-24 w-auto"
            />
          </div>

          {/* Hero text */}
          <div className="space-y-6 max-w-xl">
            <h1 className="text-display-2xl text-white">
              The marketplace for
              <br />
              Hello Sugar locations
            </h1>
            <p className="text-xl text-white leading-relaxed">
              Franchise owners list locations for sale, and approved buyers review
              financials pulled from each location&apos;s own reporting.
            </p>
          </div>

          {/* Footer */}
          <div className="text-sm font-semibold text-hs-red-100">
            For Hello Sugar franchise owners and approved partners
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12">
        <div className="w-full max-w-md space-y-10">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <img
              src="/hs-logo-stacked-color.png"
              alt="Hello Sugar"
              className="h-20 w-auto"
            />
          </div>

          {/* Header */}
          <div className="text-center lg:text-left">
            <h2 className="text-display-lg text-gray-900">Welcome back</h2>
            <p className="mt-3 text-gray-500">
              Sign in with your Hello Sugar Google account to view listings and financials.
            </p>
          </div>

          {/* Sign in link */}
          <div className="space-y-6">
            <form
              action={async () => {
                "use server"
                await signIn("google", { redirectTo: "/browse" })
              }}
            >
            <button
              type="submit"
              className="
                group w-full flex items-center justify-center gap-3
                bg-white text-gray-700
                px-5 py-4
                rounded-xl
                border-2 border-gray-200
                font-semibold
                shadow-sm
                transition-all duration-200
                hover:border-gray-300 hover:shadow-md hover:bg-gray-50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
                active:scale-[0.99]
              "
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Continue with Google</span>
              <svg
                className="h-4 w-4 text-gray-400 transition-transform group-hover:translate-x-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            </form>
          </div>

          {/* Divider between the two sign-in methods */}
          <div className="divider-text">
            <span>or</span>
          </div>

          {/* Magic-link sign-in for approved users without a Google account */}
          <form
            action={async (formData: FormData) => {
              "use server"
              const email = String(formData.get("email") ?? "").trim()
              if (!email) return
              await signIn("resend", { email, redirectTo: "/browse" })
            }}
            className="space-y-3"
          >
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="you@company.com"
              className="w-full rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-400 transition-colors focus:border-hs-red-500 focus:outline-none focus:ring-2 focus:ring-hs-red-500/20"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-hs-red-600 px-5 py-4 font-semibold text-white shadow-sm transition-all duration-200 hover:bg-hs-red-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2 active:scale-[0.99]"
            >
              Email me a sign-in link
            </button>
            <p className="text-sm text-gray-500">
              No Google account needed. We&apos;ll send a one-time link that expires in 15
              minutes.
            </p>
          </form>

          {/* Divider */}
          <div className="divider-text">
            <span>Authorized users only</span>
          </div>

          {/* Info box */}
          <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
            <div className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-hs-red-100 rounded-lg flex items-center justify-center">
                  <svg
                    className="h-5 w-5 text-hs-red-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Secure Access</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Franchise owners sign in with their Hello Sugar Google Workspace account;
                  other approved partners can use Google or an emailed sign-in link. Access
                  is limited to franchise owners and approved partners.
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="text-center text-sm text-gray-400">
            Need access?{" "}
            <a
              href="mailto:franchise@hellosugar.salon"
              className="text-hs-red-600 font-medium hover:text-hs-red-700 hover:underline underline-offset-2 transition-colors"
            >
              Contact franchise team
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
