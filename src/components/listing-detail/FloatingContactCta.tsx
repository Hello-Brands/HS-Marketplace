'use client'

export function FloatingContactCta() {
  function handleClick() {
    const contactSection = document.getElementById('contact')
    contactSection?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      {/* Mobile: full-width sticky bottom bar */}
      <div className="fixed bottom-0 inset-x-0 z-50 md:hidden bg-white border-t border-gray-200 px-4 pt-3 pb-safe shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
        <button
          onClick={handleClick}
          className="
            w-full bg-hs-red-600 text-white py-3.5 px-6 rounded-xl
            font-semibold text-base shadow-sm
            hover:bg-hs-red-700 active:bg-hs-red-800
            transition-all duration-200
            focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
            min-h-[48px]
          "
        >
          Contact Seller
        </button>
      </div>

      {/* Desktop: floating button */}
      <button
        onClick={handleClick}
        className="
          hidden md:flex items-center gap-2
          fixed bottom-6 right-6 z-50
          bg-hs-red-600 text-white py-3 px-6 rounded-full
          font-medium shadow-lg
          hover:bg-hs-red-700 hover:shadow-xl hover:-translate-y-0.5
          active:translate-y-0
          transition-all duration-200
          focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
          min-h-[48px]
        "
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Contact Seller
      </button>

      {/* Spacer for mobile bottom bar (matches bar height + safe-area inset) */}
      <div className="h-cta-spacer md:hidden" aria-hidden="true" />
    </>
  )
}
