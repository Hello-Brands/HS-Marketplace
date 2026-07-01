'use client'

import { useState } from 'react'
import { useForm, FormProvider, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { PhotoUploader } from './PhotoUploader'
import { PhotoGrid } from './PhotoGrid'
import { listingSchema } from '@/lib/listings/schemas'
import { updateListing } from '@/lib/listings/actions'
import { adminUpdateListing } from '@/lib/admin/actions'
import type { ListingFormData, Photo } from '@/lib/listings/types'

interface ListingEditFormProps {
  listingId: string
  initialData: ListingFormData
  isRejected: boolean
  isAdmin?: boolean
}

export function ListingEditForm({ listingId, initialData, isRejected, isAdmin = false }: ListingEditFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const methods = useForm<ListingFormData>({
    resolver: zodResolver(listingSchema),
    defaultValues: initialData,
  })

  const { register, control, watch, formState: { errors } } = methods
  const photos = watch('photos') || []
  const inventoryIncluded = watch('inventoryIncluded')
  const locations = watch('locations') || []
  const salonLocations = locations.filter((loc) => loc.type !== 'territory')

  const handleSubmit = async (data: ListingFormData) => {
    setFormError(null)
    setIsSubmitting(true)
    try {
      if (isAdmin) {
        await adminUpdateListing(listingId, data)
        router.push(`/admin/listings/${listingId}`)
      } else {
        await updateListing(listingId, data)
        router.push(`/seller/listings/${listingId}`)
      }
      router.refresh()
    } catch (error) {
      setFormError((error as Error).message || 'Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(handleSubmit)} className="space-y-6">
        {isRejected && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-yellow-800 text-sm">
              <span className="font-medium">Note:</span> Saving changes will automatically resubmit this listing for review.
            </p>
          </div>
        )}

        {/* Financials */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-medium mb-4">Financials</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="askingPrice" className="block text-sm font-medium text-gray-700 mb-1">
                Asking Price
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500">$</span>
                <input
                  id="askingPrice"
                  type="number"
                  {...register('askingPrice', { valueAsNumber: true })}
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              {errors.askingPrice && (
                <p className="mt-1 text-sm text-hs-red-600">{errors.askingPrice.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="ttmProfit" className="block text-sm font-medium text-gray-700 mb-1">
                TTM Profit
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500">$</span>
                <input
                  id="ttmProfit"
                  type="number"
                  {...register('ttmProfit', { valueAsNumber: true })}
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          {salonLocations.length > 0 && (
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Square footage (optional)
              </label>
              <div className="space-y-2">
                {locations.map((loc, i) =>
                  loc.type === 'territory' ? null : (
                    <div key={loc.id}>
                      {salonLocations.length > 1 && (
                        <span className="block text-xs text-gray-500 mb-1">{loc.name}</span>
                      )}
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          {...register(`locations.${i}.squareFootage`, {
                            setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                          })}
                          placeholder="e.g. 1200"
                          className="w-full pl-3 pr-12 py-2 border border-gray-300 rounded-lg"
                        />
                        <span className="absolute right-3 top-2 text-sm text-gray-500">sq ft</span>
                      </div>
                    </div>
                  ),
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">Shown on your listing when provided.</p>
            </div>
          )}

          <div className="mt-4">
            <label htmlFor="reasonForSelling" className="block text-sm font-medium text-gray-700 mb-1">
              Reason for Selling
            </label>
            <textarea
              id="reasonForSelling"
              {...register('reasonForSelling')}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        {/* Photos */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-medium mb-4">Photos</h3>
          <Controller
            name="photos"
            control={control}
            render={({ field }) => (
              <>
                <PhotoUploader
                  onUploadComplete={(photo: Photo) => {
                    field.onChange([...(field.value || []), photo])
                  }}
                  currentCount={photos.length}
                  maxCount={10}
                />
                <PhotoGrid
                  photos={field.value || []}
                  onReorder={field.onChange}
                  onRemove={(photoId) => {
                    field.onChange((field.value || []).filter((p: Photo) => p.id !== photoId))
                  }}
                />
              </>
            )}
          />
          {errors.photos && (
            <p className="mt-2 text-sm text-hs-red-600">{errors.photos.message}</p>
          )}
        </div>

        {/* Assets */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-medium mb-4">Included Assets</h3>
          <div className="space-y-3">
            <label htmlFor="inventoryIncluded" className="flex items-center gap-3">
              <input
                id="inventoryIncluded"
                type="checkbox"
                {...register('inventoryIncluded')}
                className="w-4 h-4 text-hs-red-600 rounded"
              />
              <span>Inventory included</span>
            </label>
            <label htmlFor="laserIncluded" className="flex items-center gap-3">
              <input
                id="laserIncluded"
                type="checkbox"
                {...register('laserIncluded')}
                className="w-4 h-4 text-hs-red-600 rounded"
              />
              <span>Laser device included</span>
            </label>
            {inventoryIncluded && (
              <div className="pt-1">
                <label htmlFor="inventoryCostEstimate" className="block text-sm font-medium text-gray-700 mb-1">
                  Estimated value of inventory included
                </label>
                <div className="relative max-w-xs">
                  <span className="absolute left-3 top-2 text-gray-500">$</span>
                  <input
                    id="inventoryCostEstimate"
                    type="number"
                    min="0"
                    {...register('inventoryCostEstimate', {
                      setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                    })}
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg"
                  />
                </div>
              </div>
            )}
          </div>
          <div className="mt-4">
            <label htmlFor="otherAssets" className="block text-sm font-medium text-gray-700 mb-1">
              Other Assets
            </label>
            <input
              id="otherAssets"
              type="text"
              {...register('otherAssets')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-medium mb-4">Notes</h3>
          <textarea
            {...register('notes')}
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        {/* Error message */}
        {formError && (
          <div role="alert" className="p-3 bg-hs-red-50 border border-hs-red-200 rounded-lg text-sm text-hs-red-700">
            {formError}
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2 border border-gray-300 rounded-lg font-medium focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 bg-hs-red-600 text-white rounded-lg font-medium disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            {isSubmitting ? 'Saving...' : isRejected ? 'Save & Resubmit' : 'Save Changes'}
          </button>
        </div>
      </form>
    </FormProvider>
  )
}
