'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { submitContactForm } from '@/lib/contact-actions'

interface ContactFormProps {
  listingId: string
  buyerName: string | null
  buyerEmail: string | null
  hasContacted: boolean
}

export function ContactForm({ listingId, buyerName, buyerEmail, hasContacted }: ContactFormProps) {
  const [state, formAction, pending] = useActionState(submitContactForm, null)
  const [showForm, setShowForm] = useState(false)

  // Already contacted previously (server-side check) — acknowledge it, but let the
  // buyer reach out again. Hidden once they opt to send another or a new send lands.
  if (hasContacted && !showForm && !state?.success) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-green-800 font-semibold text-lg">You&apos;ve already reached out</p>
        <p className="text-green-600 text-sm mt-1">The seller has your contact information and will reach out if interested.</p>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-green-700 hover:text-green-800 hover:underline underline-offset-2 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8m-8 4h8m-8-8h8M4 6h.01M4 12h.01M4 18h.01" />
          </svg>
          Send another message
        </button>
      </div>
    )
  }

  // Submission succeeded — show success message
  if (state?.success) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
        <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-green-800 font-semibold text-lg">Message sent successfully!</p>
        <p className="text-green-600 text-sm mt-2 max-w-xs mx-auto">
          The seller has been notified and will contact you directly. Keep an eye on your inbox.
        </p>
        <div className="mt-4 pt-4 border-t border-green-200 space-y-3">
          <p className="text-xs text-green-500">
            Sent as {buyerName ?? 'Buyer'} ({buyerEmail ?? 'N/A'})
          </p>
          <Link
            href="/browse"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 hover:text-green-800 hover:underline underline-offset-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Browse more listings
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="listingId" value={listingId} />

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700">Your Name</label>
        <input
          id="name"
          name="name"
          defaultValue={buyerName ?? ''}
          readOnly
          className="mt-1 block w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 shadow-sm text-gray-700 min-h-[44px]"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">Your Email</label>
        <input
          id="email"
          name="email"
          type="email"
          defaultValue={buyerEmail ?? ''}
          readOnly
          className="mt-1 block w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 shadow-sm text-gray-700 min-h-[44px]"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-gray-700">Phone (optional)</label>
        <input
          id="phone"
          name="phone"
          type="tel"
          placeholder="(555) 555-5555"
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 shadow-sm focus:border-hs-red-500 focus:ring-2 focus:ring-hs-red-500/20 focus:outline-none transition-all duration-200 min-h-[44px]"
        />
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-gray-700">Message (optional)</label>
        <textarea
          id="message"
          name="message"
          rows={4}
          placeholder="Tell the seller why you're interested..."
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 shadow-sm focus:border-hs-red-500 focus:ring-2 focus:ring-hs-red-500/20 focus:outline-none transition-all duration-200"
        />
      </div>

      {state?.error && (
        <p className="text-hs-red-600 text-sm">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="
          w-full bg-hs-red-600 text-white py-3 px-6 rounded-xl font-medium
          hover:bg-hs-red-700 disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200 shadow-sm hover:shadow-md
          focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2
          min-h-[48px]
        "
      >
        {pending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Sending...
          </span>
        ) : (
          'Send Message'
        )}
      </button>
    </form>
  )
}
