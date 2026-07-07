'use client'

import { useState, useEffect, useCallback } from 'react'
import { useForm, FormProvider, type FieldPath } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { StepIndicator } from '@/components/ui/StepIndicator'
import { TypeLocationStep } from './steps/TypeLocationStep'
import { FinancialsStep } from './steps/FinancialsStep'
import { PhotosDetailsStep } from './steps/PhotosDetailsStep'
import { listingSchema, stepSchemas, getFieldsForStep } from '@/lib/listings/schemas'
import { saveDraft, submitListing } from '@/lib/listings/actions'
import type { ListingFormData } from '@/lib/listings/types'

type SaveToast = 'idle' | 'saving' | 'saved' | 'error'

interface ListingWizardProps {
  userId: string
}

export function ListingWizard({ userId }: ListingWizardProps) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [listingId, setListingId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saveToast, setSaveToast] = useState<SaveToast>('idle')

  // Auto-dismiss save toast
  useEffect(() => {
    if (saveToast === 'saved' || saveToast === 'error') {
      const timer = setTimeout(() => setSaveToast('idle'), 2500)
      return () => clearTimeout(timer)
    }
  }, [saveToast])

  const methods = useForm<ListingFormData>({
    resolver: zodResolver(listingSchema),
    mode: 'onBlur',
    defaultValues: {
      type: undefined,
      locations: [],
      askingPrice: 0,
      photos: [],
      inventoryIncluded: false,
      laserIncluded: false,
    },
  })

  const handleSaveDraft = useCallback(async (values: ListingFormData) => {
    setSaveToast('saving')
    try {
      const result = await saveDraft(values, listingId || undefined)
      if (result.listingId && !listingId) {
        setListingId(result.listingId)
      }
      setSaveToast('saved')
      return result
    } catch {
      setSaveToast('error')
      return { listingId: null }
    }
  }, [listingId])

  const handleStepComplete = async (nextStep: number) => {
    // Validate ONLY the current step, against that step's own schema. Field-scoping
    // the combined `listingSchema` here fails because it is a `.and()` intersection
    // (later-step fields like empty `photos` would block advancing this step).
    const values = methods.getValues()
    const stepSchema = stepSchemas[step]
    methods.clearErrors(getFieldsForStep(step))
    if (stepSchema) {
      const result = stepSchema.safeParse(values)
      if (!result.success) {
        for (const issue of result.error.issues) {
          methods.setError(issue.path.join('.') as FieldPath<ListingFormData>, {
            type: 'validation',
            message: issue.message,
          })
        }
        return
      }
    }

    // Auto-save draft with toast
    await handleSaveDraft(values)

    setStep(nextStep)
  }

  const handleSaveAndExit = async () => {
    const values = methods.getValues()
    const hasType = !!values.type
    const hasLocations = values.locations && values.locations.length > 0

    // If no existing draft and no meaningful data, just navigate away
    if (!listingId && !hasType && !hasLocations) {
      router.push('/seller/listings')
      return
    }

    // Only save if there's actual data worth saving
    try {
      await handleSaveDraft(values)
    } catch {
      // Best-effort save; navigate regardless
    }
    router.push('/seller/listings')
  }

  const handleSubmit = async () => {
    // Validate all fields
    const isValid = await methods.trigger()
    if (!isValid) return

    setSubmitError(null)
    setIsSubmitting(true)
    try {
      // Save final draft
      const values = methods.getValues()
      const saveResult = await saveDraft(values, listingId || undefined)
      const finalListingId = saveResult.listingId || listingId

      if (!finalListingId) {
        throw new Error('Failed to save listing')
      }

      // Submit for review
      await submitListing(finalListingId)

      // Redirect to success page
      router.push(`/seller/listings/${finalListingId}/submitted`)
    } catch (error) {
      console.error('Submit failed:', error)
      setSubmitError("We couldn't submit your listing. Check your connection and try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={(e) => e.preventDefault()}>
        {/* Save status bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm" aria-live="polite">
            {saveToast === 'saving' && (
              <span className="text-gray-500 flex items-center gap-1.5">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </span>
            )}
            {saveToast === 'saved' && (
              <span className="text-green-600 flex items-center gap-1.5 animate-fade-in">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Draft saved
              </span>
            )}
            {saveToast === 'error' && (
              <span className="text-hs-red-600 flex items-center gap-1.5 animate-fade-in">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Save failed
              </span>
            )}
            {saveToast === 'idle' && (
              <span className="text-gray-400 flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Progress saved automatically
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSaveAndExit}
            className="inline-flex items-center min-h-[44px] p-2 -m-2 text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2 rounded"
          >
            Save &amp; Exit
          </button>
        </div>

        <StepIndicator current={step} total={3} />

        {step === 1 && (
          <TypeLocationStep
            userId={userId}
            onNext={() => handleStepComplete(2)}
            onSaveAndExit={handleSaveAndExit}
            isSaving={saveToast === 'saving'}
          />
        )}

        {step === 2 && (
          <FinancialsStep
            onNext={() => handleStepComplete(3)}
            onBack={() => setStep(1)}
            onSaveAndExit={handleSaveAndExit}
            isSaving={saveToast === 'saving'}
          />
        )}

        {step === 3 && (
          <>
            <PhotosDetailsStep
              onSubmit={handleSubmit}
              onBack={() => setStep(2)}
              onSaveAndExit={handleSaveAndExit}
              isSubmitting={isSubmitting}
              isSaving={saveToast === 'saving'}
            />
            {submitError && (
              <div role="alert" className="mt-4 p-3 bg-hs-red-50 border border-hs-red-200 rounded-lg text-sm text-hs-red-700">
                {submitError}
              </div>
            )}
          </>
        )}
      </form>
    </FormProvider>
  )
}
