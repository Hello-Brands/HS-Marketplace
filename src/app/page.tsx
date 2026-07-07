import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/auth"

export default async function HomePage() {
  // Signed-in visitors get no confirmation or path forward from the logged-out
  // marketing page, so send them to the main authed landing (/browse). Mirrors
  // the inverse guard used across authed server components (e.g. browse/page.tsx).
  const session = await auth()
  if (session?.user) {
    redirect("/browse")
  }

  return (
    <main className="min-h-screen">
      {/* Navigation */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <img
                src="/hs-logo-horizontal-color.png"
                alt="Hello Sugar"
                className="h-8 w-auto"
              />
              <span className="hidden sm:inline-block pl-3 border-l border-gray-300 font-semibold text-gray-900 tracking-tight">
                Marketplace
              </span>
            </div>

            {/* CTA */}
            <Link
              href="/login"
              className="
                inline-flex items-center gap-2
                min-h-[44px]
                bg-hs-red-600 text-white
                px-5 py-2.5 rounded-full
                text-base font-semibold
                transition-colors duration-200
                hover:bg-hs-red-700
                active:scale-[0.98]
              "
            >
              Sign In
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-24 lg:pt-40 lg:pb-32">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto stagger-children">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-hs-red-100 text-hs-red-700 px-4 py-2 rounded-full text-sm font-semibold mb-8">
              <span className="w-2 h-2 bg-hs-red-500 rounded-full" />
              Now accepting new listings
            </div>

            {/* Headline */}
            <h1 className="text-display-2xl text-gray-900">
              Buy or sell a
              <br />
              <span className="text-hs-red-600">Hello Sugar</span> location
            </h1>

            {/* Subheadline */}
            <p className="mt-6 text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              A private marketplace for the Hello Sugar franchise network. Every listing
              shows financials pulled from the location&apos;s own reporting, so buyers and
              sellers start from the same numbers.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login"
                className="
                  inline-flex items-center gap-2
                  min-h-[44px]
                  bg-hs-red-600 text-white
                  px-7 py-3.5 rounded-full
                  text-base font-semibold
                  transition-colors duration-200
                  hover:bg-hs-red-700
                  active:scale-[0.98]
                "
              >
                Browse Listings
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <Link
                href="/login"
                className="
                  inline-flex items-center gap-2
                  min-h-[44px]
                  bg-white text-gray-900
                  px-7 py-3.5 rounded-full
                  text-base font-semibold
                  border border-gray-300
                  transition-colors duration-200
                  hover:bg-gray-50
                  active:scale-[0.98]
                "
              >
                List Your Location
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Data Section */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="max-w-2xl mb-16">
            <h2 className="text-display-lg text-gray-900">
              Built on real location data
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Listings connect to Hello Sugar&apos;s own reporting, so the numbers a buyer
              sees are the numbers the owner sees.
            </p>
          </div>

          <div className="grid md:grid-cols-5 gap-6 items-start">
            {/* Emphasized card */}
            <div className="md:col-span-3 bg-white rounded-2xl p-8 sm:p-10 border border-gray-200">
              <div className="w-12 h-12 bg-hs-red-100 rounded-xl flex items-center justify-center mb-6">
                <svg className="h-6 w-6 text-hs-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">
                Verified financials
              </h3>
              <p className="text-gray-600 leading-relaxed max-w-lg">
                Net sales, membership counts, and client metrics come straight from the
                location&apos;s reporting, not from a spreadsheet the seller assembled.
                What you see in a listing is what the business actually recorded.
              </p>
            </div>

            {/* Supporting list */}
            <div className="md:col-span-2 bg-white rounded-2xl border border-gray-200 divide-y divide-gray-200">
              <div className="p-6 sm:p-7">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 shrink-0 bg-hs-caramel-200/50 rounded-xl flex items-center justify-center">
                    <svg className="h-5 w-5 text-hs-caramel-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">
                      Twelve months of trend
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Each listing includes a year of revenue and membership conversion
                      history, so you can see where a location is headed.
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6 sm:p-7">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 shrink-0 bg-hs-red-100 rounded-xl flex items-center justify-center">
                    <svg className="h-5 w-5 text-hs-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">
                      A known network
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      Everyone signs in with a Hello Sugar account. Buyers and sellers
                      already share the same franchise system.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Listing Types Section */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-start">
            <div className="max-w-md">
              <h2 className="text-display-lg text-gray-900">
                What gets listed
              </h2>
              <p className="mt-4 text-lg text-gray-600">
                Four kinds of opportunities come through the marketplace, from a single
                suite to a multi-location portfolio.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-200">
              {[
                { type: "Suite", desc: "A single-room location inside a salon suite building", tone: "red", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
                { type: "Flagship", desc: "A full standalone studio with its own storefront", tone: "caramel", icon: "M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" },
                { type: "Territory", desc: "Development rights for a defined market area", tone: "red", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" },
                { type: "Bundle", desc: "Several locations sold together as one deal", tone: "caramel", icon: "M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z" },
              ].map((item) => (
                <div key={item.type} className="flex items-center gap-4 p-5 sm:p-6">
                  <div
                    className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center ${
                      item.tone === "red" ? "bg-hs-red-100" : "bg-hs-caramel-200/50"
                    }`}
                  >
                    <svg
                      className={`h-5 w-5 ${item.tone === "red" ? "text-hs-red-600" : "text-hs-caramel-700"}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{item.type}</h3>
                    <p className="text-sm text-gray-600">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-hs-red-600">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-display-xl text-white mb-6">
            Thinking about buying or selling?
          </h2>
          <p className="text-xl text-white mb-10 max-w-2xl mx-auto">
            Sign in to see what&apos;s on the market, or start the process of listing
            your own location.
          </p>
          <Link
            href="/login"
            className="
              inline-flex items-center gap-3
              min-h-[44px]
              bg-white text-gray-900
              px-8 py-4 rounded-full
              text-lg font-semibold
              transition-colors duration-200
              hover:bg-hs-red-50
              active:scale-[0.98]
            "
          >
            Sign In
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-12">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img
                src="/hs-logo-drop.png"
                alt="Hello Sugar"
                className="h-8 w-auto"
              />
              <span className="text-sm text-gray-600">
                Hello Sugar Marketplace
              </span>
            </div>
            <div className="text-sm text-gray-500">
              Internal platform for the Hello Sugar franchise network
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
