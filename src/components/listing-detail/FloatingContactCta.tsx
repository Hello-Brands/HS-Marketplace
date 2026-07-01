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

      {/* Spacer for mobile bottom bar (matches bar height + safe-area inset) */}
      <div className="h-cta-spacer md:hidden" aria-hidden="true" />
    </>
  )
}
