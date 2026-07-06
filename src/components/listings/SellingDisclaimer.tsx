// Static "Selling Your Franchise" disclaimer content shown on the add-listing
// gate. Copy is intentionally hardcoded (legal text). Fee amounts reference the
// Franchise Agreement / 2026 FDD rather than stating figures.
export function SellingDisclaimer() {
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Selling Your Franchise</h2>
      <p className="mt-1 text-sm text-gray-500">
        Before you begin, here&apos;s what you should know about the resale process.
      </p>

      {/* The basics */}
      <h3 className="mt-6 text-[11px] font-bold uppercase tracking-wider text-amber-700">The basics</h3>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <span className="inline-flex flex-none rounded-full bg-hs-red-100 p-2 text-hs-red-700">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
              </svg>
            </span>
            How long does it take?
          </div>
          <p className="mt-1 text-sm text-gray-700 leading-relaxed">
            Selling a Hello Sugar can take anywhere from <strong>1–18 months</strong>. The health of your
            business, financing options, and market conditions all affect timing.
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <span className="inline-flex flex-none rounded-full bg-hs-red-100 p-2 text-hs-red-700">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 7v1m0 8v1m9-5a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </span>
            What&apos;s it worth?
          </div>
          <p className="mt-1 text-sm text-gray-700 leading-relaxed">
            Profitable businesses typically sell at a <strong>3–5× multiple of earnings</strong>. Unprofitable
            locations are generally valued based on equipment, outstanding liabilities, and lease assumption.
          </p>
        </div>
      </div>

      {/* Fee structure */}
      <h3 className="mt-6 text-[11px] font-bold uppercase tracking-wider text-amber-700">Fee structure</h3>
      <p className="text-sm text-gray-500">Review all applicable fees before submitting your inquiry.</p>

      <div className="mt-3 rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-900">Option A — Self-Managed Sale</div>
        <p className="mt-0.5 text-sm text-gray-500">
          You find your own buyer. Hello Sugar is not involved in the transaction beyond approving the transfer.
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li>Transfer Fee (per your Franchise Agreement / 2026 FDD)</li>
          <li>Fee Deposit (per your Franchise Agreement)</li>
          <li>Your own legal fees for the transaction</li>
        </ul>
      </div>

      <div className="mt-3 rounded-xl border border-gray-200 p-4">
        <div className="text-sm font-bold text-gray-900">Option B — Hello Sugar-Managed Sale</div>
        <p className="mt-0.5 text-sm text-gray-500">
          Ana and the Hello Sugar team manage the sale process on your behalf — finding a buyer, coordinating
          diligence, and facilitating the transaction.
        </p>
        <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
          <li>Transfer Fee (per your Franchise Agreement / 2026 FDD)</li>
          <li>Resale Assistance Fee (per your Franchise Agreement / 2026 FDD)</li>
        </ul>
        <div className="mt-3 rounded-lg border border-dashed border-amber-400 bg-amber-50/60 p-3 text-sm text-gray-700 leading-relaxed">
          <strong>Broker Fees (if applicable)</strong> — If a broker is involved, a fee of{" "}
          <strong>$30,000 flat or 10% of the final sale price</strong> (whichever applies) is the seller&apos;s
          responsibility.
        </div>
      </div>

      <p className="mt-3 text-sm italic text-gray-500">
        All fees must be wired to Hello Sugar 3 business days prior to close.
      </p>

      {/* Reworked close: reversible listing vs permanent sale */}
      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200">
        <div className="px-4 pt-4 pb-1 text-sm font-bold text-gray-900">
          Listing is reversible — only a completed sale is permanent
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <div className="bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-800">
            <div className="flex items-center gap-2 font-bold">
              <span className="inline-flex flex-none rounded-full bg-hs-red-100 p-2 text-hs-red-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              Listing commits you to nothing
            </div>
            Change your mind, or don&apos;t get an offer you love? You can remove your listing at any time before
            a sale closes — no penalty, no obligation.
          </div>
          <div className="bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 sm:border-l border-amber-100">
            <div className="flex items-center gap-2 font-bold">
              <span className="inline-flex flex-none rounded-full bg-hs-red-100 p-2 text-hs-red-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86l-8.48 14.7A1 1 0 002.68 20h18.64a1 1 0 00.87-1.44l-8.48-14.7a1 1 0 00-1.74 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01" />
                </svg>
              </span>
              A completed sale is permanent
            </div>
            Once a transfer closes, you&apos;ll no longer be a Hello Sugar franchisee. Please be sure before you
            finalize a transaction.
          </div>
        </div>
      </div>
    </div>
  )
}
