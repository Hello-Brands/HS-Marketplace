import Link from "next/link"

export default function HomePage() {
  // Simplified - no auth check for debugging
  return (
    <main className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <img
                src="/logo-hello-sugar-color.png"
                alt="Hello Sugar"
                className="h-8 w-auto"
              />
              <span className="hidden sm:inline-block pl-3 border-l border-gray-200 font-semibold text-gray-900 tracking-tight">
                Marketplace
              </span>
            </div>

            {/* CTA */}
            <Link
              href="/login"
              className="
                inline-flex items-center gap-2
                bg-gray-900 text-white
                px-4 py-2 rounded-lg
                text-sm font-semibold
                transition-all duration-200
                hover:bg-gray-800
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
      <section className="relative pt-32 pb-24 lg:pt-40 lg:pb-32 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 bg-gradient-radial pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-hs-red-100/50 rounded-full blur-[150px] pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-4xl mx-auto stagger-children">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 bg-hs-red-50 text-hs-red-700 px-4 py-2 rounded-full text-sm font-semibold mb-8">
              <span className="w-2 h-2 bg-hs-red-500 rounded-full animate-pulse-soft" />
              Now accepting new listings
            </div>

            {/* Headline */}
            <h1 className="text-display-2xl text-gray-900">
              Buy and sell
              <br />
              <span className="text-gradient-hs">Hello Sugar</span> locations
            </h1>

            {/* Subheadline */}
            <p className="mt-6 text-xl text-gray-500 max-w-2xl mx-auto leading-relaxed">
              The only marketplace with verified financials pulled directly from Hello Sugar systems.
              Real numbers. Real connections. Real deals.
            </p>

            {/* CTAs */}
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login"
                className="
                  inline-flex items-center gap-2
                  bg-hs-red-600 text-white
                  px-6 py-3.5 rounded-xl
                  text-base font-semibold
                  shadow-lg shadow-hs-red-500/25
                  transition-all duration-200
                  hover:bg-hs-red-700 hover:shadow-xl hover:shadow-hs-red-500/30
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
                  bg-white text-gray-700
                  px-6 py-3.5 rounded-xl
                  text-base font-semibold
                  border-2 border-gray-200
                  transition-all duration-200
                  hover:border-gray-300 hover:bg-gray-50
                  active:scale-[0.98]
                "
              >
                List Your Location
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-gray-50 border-y border-gray-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-display-lg text-gray-900">
              What makes us different
            </h2>
            <p className="mt-4 text-lg text-gray-500 max-w-2xl mx-auto">
              Unlike generic business marketplaces, we pull live data directly from Hello Sugar systems.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-white rounded-2xl p-8 border border-gray-200 hover-lift">
              <div className="w-12 h-12 bg-hs-red-100 rounded-xl flex items-center justify-center mb-6">
                <svg className="h-6 w-6 text-hs-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Verified Financials
              </h3>
              <p className="text-gray-500 leading-relaxed">
                Revenue, cash flow, and client metrics pulled live from Hello Sugar&apos;s internal systems.
                No inflated numbers or outdated spreadsheets.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-white rounded-2xl p-8 border border-gray-200 hover-lift">
              <div className="w-12 h-12 bg-hs-red-100 rounded-xl flex items-center justify-center mb-6">
                <svg className="h-6 w-6 text-hs-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Trend Analysis
              </h3>
              <p className="text-gray-500 leading-relaxed">
                See 12-month revenue trends, client acquisition rates, and membership conversions
                to understand the real trajectory.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-white rounded-2xl p-8 border border-gray-200 hover-lift">
              <div className="w-12 h-12 bg-hs-red-100 rounded-xl flex items-center justify-center mb-6">
                <svg className="h-6 w-6 text-hs-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Pre-Qualified Buyers
              </h3>
              <p className="text-gray-500 leading-relaxed">
                Every user is authenticated through Hello Sugar. No tire-kickers — only
                serious franchisees and approved partners.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Listing Types Section */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-display-lg text-gray-900">
              Find what you&apos;re looking for
            </h2>
            <p className="mt-4 text-lg text-gray-500">
              From single suites to multi-location bundles and development territories.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { type: "Suite", desc: "Single room locations", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
              { type: "Flagship", desc: "Full studio locations", icon: "M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" },
              { type: "Territory", desc: "Development rights", icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" },
              { type: "Bundle", desc: "Multiple locations", icon: "M17 14v6m-3-3h6M6 10h2a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2zm10 0h2a2 2 0 002-2V6a2 2 0 00-2-2h-2a2 2 0 00-2 2v2a2 2 0 002 2zM6 20h2a2 2 0 002-2v-2a2 2 0 00-2-2H6a2 2 0 00-2 2v2a2 2 0 002 2z" },
            ].map((item) => (
              <div
                key={item.type}
                className="group bg-white rounded-2xl p-6 border border-gray-200 hover:border-hs-red-200 hover:shadow-lg transition-all duration-300 cursor-pointer"
              >
                <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mb-4 group-hover:bg-hs-red-100 transition-colors">
                  <svg
                    className="h-6 w-6 text-gray-600 group-hover:text-hs-red-600 transition-colors"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{item.type}</h3>
                <p className="text-sm text-gray-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gray-950 relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-hs-red-600/20 rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-hs-red-500/10 rounded-full blur-[100px]" />

        <div className="relative max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-display-xl text-white mb-6">
            Ready to make a move?
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            Whether you&apos;re looking to expand your portfolio or transition to new ownership,
            we&apos;ll help you find the right match.
          </p>
          <Link
            href="/login"
            className="
              inline-flex items-center gap-3
              bg-white text-gray-900
              px-8 py-4 rounded-xl
              text-lg font-semibold
              transition-all duration-200
              hover:bg-gray-100
              active:scale-[0.98]
            "
          >
            Get Started
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-100 py-12">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-hs-red-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-xs">HS</span>
              </div>
              <span className="text-sm text-gray-500">
                Hello Sugar Marketplace
              </span>
            </div>
            <div className="text-sm text-gray-400">
              Internal platform for Hello Sugar franchise network
            </div>
          </div>
        </div>
      </footer>
    </main>
  )
}
