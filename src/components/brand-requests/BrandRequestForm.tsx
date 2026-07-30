'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { submitBrandRequest } from '@/lib/brand-requests/actions'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'

/**
 * Franchisee-facing submit form. Field names are a CONTRACT with
 * submitBrandRequest's zod schema (brandName, websiteUrl, note, knownCityState).
 *
 * Validation is deliberately thin on the client — `required` only. The action
 * owns the real rules (URL normalization, blocked social domains, reachability,
 * dedupe against monitored brands and open requests) and returns them as
 * `{ error }` for inline display.
 */
export function BrandRequestForm() {
  const [state, formAction, pending] = useActionState(submitBrandRequest, null)

  if (state && 'success' in state && state.success) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <div className="w-14 h-14 bg-hs-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-7 h-7 text-hs-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-gray-900">Request submitted</p>
        <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
          It&apos;s under review now. You can track its status any time on your requests
          page — we&apos;ll take it from here.
        </p>
        <div className="mt-6">
          <Link
            href="/account/brand-requests"
            className="inline-flex items-center px-5 py-2.5 rounded-lg bg-hs-red-600 text-white text-sm font-semibold hover:bg-hs-red-700 transition-colors"
          >
            View my requests
          </Link>
        </div>
      </div>
    )
  }

  const error = state && 'error' in state ? state.error : null

  return (
    <form action={formAction} className="space-y-5">
      <Input
        name="brandName"
        label="Brand name"
        required
        maxLength={120}
        autoComplete="off"
        placeholder="Brand Name"
      />

      <Input
        name="websiteUrl"
        label="Website"
        required
        maxLength={500}
        inputMode="url"
        autoComplete="off"
        placeholder="https://brandname.com"
        hint="Link the brand's own website — not a Facebook, Instagram, or Yelp page."
      />

      <Textarea
        name="note"
        label="Where have you seen them?"
        rows={4}
        maxLength={2000}
        placeholder="Optional — anything that helps us find their locations."
      />

      <Input
        name="knownCityState"
        label="City/state of a location you know"
        maxLength={120}
        autoComplete="off"
        placeholder="Austin, TX"
      />

      {error && (
        <p className="text-sm text-hs-red-600" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" fullWidth loading={pending}>
        {pending ? 'Submitting...' : 'Submit request'}
      </Button>
    </form>
  )
}
