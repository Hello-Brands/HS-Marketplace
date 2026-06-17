import { z } from 'zod'
import type { ListingFormData } from './types'

// Sub-schema for photo
const photoSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  filename: z.string(),
  order: z.number(),
})

// Sub-schema for a location selection
const locationSelectionSchema = z.object({
  id: z.string(),
  type: z.enum(['salon', 'territory']),
  externalId: z.string().optional(),
  name: z.string().min(1, 'Location name is required'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  squareFootage: z.number().optional(),
  openingDate: z.date().optional(),
  ttmRevenue: z.number().optional(),
  mcr: z.number().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  territoryLat: z.number().optional(),
  territoryLng: z.number().optional(),
  territoryRadius: z.number().optional(),
})

// Step 1: Type + Location
export const typeLocationSchema = z.object({
  type: z.enum(['suite', 'flagship', 'territory', 'bundle']),
  locations: z.array(locationSelectionSchema).min(1, 'Select at least one location'),
}).superRefine((data, ctx) => {
  // Territory type requires lat/lng/radius on territory locations
  if (data.type === 'territory' || data.type === 'bundle') {
    const territoryLocations = data.locations.filter(loc => loc.type === 'territory')
    for (let i = 0; i < territoryLocations.length; i++) {
      const loc = territoryLocations[i]
      if (loc.territoryLat == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Territory latitude is required',
          path: ['locations', i, 'territoryLat'],
        })
      }
      if (loc.territoryLng == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Territory longitude is required',
          path: ['locations', i, 'territoryLng'],
        })
      }
      if (loc.territoryRadius == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Territory radius is required',
          path: ['locations', i, 'territoryRadius'],
        })
      }
    }
  }
})

// Step 2: Financials
export const financialsSchema = z.object({
  askingPrice: z.number().positive('Enter a valid price'),
  ttmProfit: z.number().optional(),
  reasonForSelling: z.string().max(500, 'Maximum 500 characters').optional(),
})

// Step 3: Photos + Details
export const photosDetailsSchema = z.object({
  photos: z
    .array(photoSchema)
    .min(1, 'Upload at least 1 photo')
    .max(10, 'Maximum 10 photos'),
  inventoryIncluded: z.boolean(),
  laserIncluded: z.boolean(),
  otherAssets: z.string().max(500, 'Maximum 500 characters').optional(),
  notes: z.string().max(2000, 'Maximum 2000 characters').optional(),
})

// Combined schema for full listing
export const listingSchema = typeLocationSchema.and(financialsSchema).and(photosDetailsSchema)

// Helper to get field names for each step (used with react-hook-form trigger())
export function getFieldsForStep(step: number): (keyof ListingFormData)[] {
  switch (step) {
    case 1:
      return ['type', 'locations']
    case 2:
      return ['askingPrice', 'ttmProfit', 'reasonForSelling']
    case 3:
      return ['photos', 'inventoryIncluded', 'laserIncluded', 'otherAssets', 'notes']
    default:
      return []
  }
}
