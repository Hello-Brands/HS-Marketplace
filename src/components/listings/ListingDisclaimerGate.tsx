"use client"

import { useState } from "react"
import { SellingDisclaimer } from "./SellingDisclaimer"
import { ListingWizard } from "./ListingWizard"
import { acknowledgeSellingDisclaimer } from "@/lib/listings/disclaimer-actions"

interface ListingDisclaimerGateProps {
  userId: string
}

export function ListingDisclaimerGate({ userId }: ListingDisclaimerGateProps) {
  const [acknowledged, setAcknowledged] = useState(false)
  const [checked, setChecked] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Once acknowledged (and recorded server-side), the wizard replaces the gate.
  if (acknowledged) {
    return <ListingWizard userId={userId} />
  }

  const handleContinue = async () => {
    if (!checked || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await acknowledgeSellingDisclaimer()
      setAcknowledged(true)
    } catch {
      // Record-to-proceed: hold the seller on the gate so we always capture the
      // acknowledgment before the form opens. The box stays checked for retry.
      setError("We couldn't record your acknowledgment. Check your connection and try again.")
      setSubmitting(false)
    }
  }

  return (
    <div>
      <SellingDisclaimer />

      <label className="mt-6 flex items-start gap-3 rounded-xl border border-gray-200 p-4 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] accent-hs-red-600"
        />
        <span className="text-sm text-gray-800 leading-relaxed">
          I have read and understand the fee structure, and I understand that while I can remove my listing at
          any time, <strong>a completed sale is permanent</strong>.
        </span>
      </label>

      {error && (
        <div role="alert" className="mt-4 p-3 bg-hs-red-50 border border-hs-red-200 rounded-lg text-sm text-hs-red-700">
          {error}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!checked || submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-hs-red-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-hs-red-700 disabled:cursor-not-allowed disabled:bg-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
        >
          {submitting ? "Saving…" : "Continue to Form →"}
        </button>
      </div>
    </div>
  )
}
