'use client'

import { useFormContext, Controller } from 'react-hook-form'
import { PhotoUploader } from '../PhotoUploader'
import { PhotoGrid } from '../PhotoGrid'
import type { ListingFormData, Photo } from '@/lib/listings/types'

interface PhotosDetailsStepProps {
  onSubmit: () => void
  onBack: () => void
  onSaveAndExit: () => void
  isSubmitting: boolean
  isSaving: boolean
}

export function PhotosDetailsStep({ onSubmit, onBack, onSaveAndExit, isSubmitting, isSaving }: PhotosDetailsStepProps) {
  const { register, control, watch, formState: { errors } } = useFormContext<ListingFormData>()
  const photos = watch('photos') || []
  const inventoryIncluded = watch('inventoryIncluded')

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Photos</h3>
        <p className="text-sm text-gray-500 mb-4">
          Upload 1-10 photos. Drag to reorder -- first photo becomes the cover.
        </p>
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
                onRemove={(id) => {
                  field.onChange((field.value || []).filter((p: Photo) => p.id !== id))
                }}
              />
            </>
          )}
        />
        {errors.photos && (
          <p className="mt-2 text-sm text-hs-red-600">{errors.photos.message}</p>
        )}
      </div>

      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">What&apos;s included in the sale?</h3>
        <p className="text-sm text-gray-500 mb-4">Check all assets that will transfer to the buyer.</p>
        <div className="space-y-3">
          <label htmlFor="inventoryIncluded" className="flex items-center gap-3 cursor-pointer min-h-[44px]">
            <input
              id="inventoryIncluded"
              type="checkbox"
              {...register('inventoryIncluded')}
              className="w-5 h-5 text-hs-red-600 rounded focus:ring-hs-red-500"
            />
            <span className="text-gray-700">Inventory (wax, supplies, retail products)</span>
          </label>
          {inventoryIncluded && (
            <div className="ml-8">
              <label htmlFor="inventoryCostEstimate" className="block text-sm font-medium text-gray-700 mb-1">
                Estimated value of inventory included (optional)
              </label>
              <div className="relative max-w-xs">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  id="inventoryCostEstimate"
                  type="number"
                  min="0"
                  {...register('inventoryCostEstimate', {
                    setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                  })}
                  placeholder="0"
                  className="w-full pl-7 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-hs-red-500 focus:border-hs-red-500 min-h-[44px]"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">Shown to buyers on your listing.</p>
            </div>
          )}
          <label htmlFor="laserIncluded" className="flex items-center gap-3 cursor-pointer min-h-[44px]">
            <input
              id="laserIncluded"
              type="checkbox"
              {...register('laserIncluded')}
              className="w-5 h-5 text-hs-red-600 rounded focus:ring-hs-red-500"
            />
            <span className="text-gray-700">Laser hair removal device</span>
          </label>
        </div>
      </div>

      <div>
        <label htmlFor="otherAssets" className="block text-sm font-medium text-gray-700 mb-1">
          Other assets included (optional)
        </label>
        <input
          id="otherAssets"
          type="text"
          {...register('otherAssets')}
          placeholder="e.g., furniture, signage, display cases"
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-hs-red-500 focus:border-hs-red-500 min-h-[44px]"
        />
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Anything else buyers should know? (optional)
        </label>
        <textarea
          id="notes"
          {...register('notes')}
          rows={4}
          maxLength={2000}
          placeholder="e.g., Lease terms, staff situation, growth opportunities, recent improvements..."
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-hs-red-500 focus:border-hs-red-500"
        />
        <p className="mt-1 text-xs text-gray-500">This will be visible to potential buyers. Max 2000 characters.</p>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            disabled={isSubmitting}
            className="px-5 py-2.5 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50 min-h-[44px] transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onSaveAndExit}
            disabled={isSubmitting || isSaving}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors min-h-[44px] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
          >
            Save &amp; Exit
          </button>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isSubmitting || photos.length === 0}
          className="px-6 py-2.5 bg-hs-red-600 text-white rounded-lg font-semibold hover:bg-hs-red-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] transition-colors focus-visible:ring-2 focus-visible:ring-hs-red-500 focus-visible:ring-offset-2"
        >
          {isSubmitting ? 'Submitting...' : 'Submit for Review'}
        </button>
      </div>
    </div>
  )
}
