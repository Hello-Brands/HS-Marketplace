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

// Step 1: Type + Location — the plain object, kept separate from the refinement
// so the full listing schema can be composed with `.merge()` (a ZodObject) rather
// than `.and()` (an intersection, which cannot be `.partial()`-ed or field-scoped).
const typeLocationBase = z.object({
  type: z.enum(['suite', 'flagship', 'territory', 'bundle']),
  locations: z.array(locationSelectionSchema).min(1, 'Select at least one location'),
})

type TypeLocationShape = z.infer<typeof typeLocationBase>

// Territory/bundle listings need a centre + radius on every territory row.
// Extracted so step 1 and the full listing schema enforce it from one definition.
function territoryRefinement(data: TypeLocationShape, ctx: z.RefinementCtx) {
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
}

export const typeLocationSchema = typeLocationBase.superRefine(territoryRefinement)

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
  inventoryCostEstimate: z.number().nonnegative('Enter a valid amount').optional(),
  otherAssets: z.string().max(500, 'Maximum 500 characters').optional(),
  notes: z.string().max(2000, 'Maximum 2000 characters').optional(),
})

// Combined schema for a full listing (final submit validation only). Composed with
// `.merge()` so it stays a ZodObject — the previous `.and()` intersection could not
// be field-scoped or `.partial()`-ed, which is what let a still-empty later-step
// field silently fail an earlier step.
const listingObjectSchema = typeLocationBase.merge(financialsSchema).merge(photosDetailsSchema)

export const listingSchema = listingObjectSchema.superRefine(territoryRefinement)

/**
 * Server-side validation for a PARTIAL write — `saveDraft` and `adminUpdateListing`
 * both accept `Partial<ListingFormData>`, so the full schema cannot be used (a draft
 * legitimately has no photos, no price yet, and possibly no locations).
 *
 * This exists because neither write path validated anything server-side: the schemas
 * above were wired only into the client's react-hook-form resolver, so every type,
 * range and max-length constraint was bypassed by posting to the action or to
 * /api/listings/draft directly.
 *
 * It deliberately relaxes REQUIREDNESS and in-progress minimums while keeping the
 * constraints that matter for a stored row:
 * - every field optional (it's a patch)
 * - `locations`/`photos` lose their `.min(1)` — a draft may have none yet — but
 *   `photos` keeps its max of 10, and each element is still fully validated
 * - `askingPrice` allows 0 while a seller is still typing; `.positive()` is enforced
 *   at submit time by `listingSchema`
 * - enums, number-ness and every string max length stay strict
 *
 * Unknown keys are stripped (zod's default), so callers should pass the PARSED data
 * downstream rather than the raw payload.
 */
// Server-side variant of a location: /api/listings/draft delivers `openingDate` as
// an ISO string (it goes through `request.json()`), so coerce here. This stays out
// of `locationSelectionSchema` itself because `z.coerce.date()` widens the schema's
// INPUT type to `unknown`, which breaks the typed react-hook-form resolver.
const locationSelectionPatchSchema = locationSelectionSchema.extend({
  openingDate: z.coerce.date().optional(),
})

export const listingPatchSchema = listingObjectSchema
  .partial()
  .extend({
    locations: z.array(locationSelectionPatchSchema).optional(),
    photos: z.array(photoSchema).max(10, 'Maximum 10 photos').optional(),
    askingPrice: z.number().nonnegative('Enter a valid price').optional(),
  })

/**
 * Validate a partial listing write and return the parsed payload. Throws with the
 * offending paths on failure — `saveDraft` and `adminUpdateListing` already signal
 * refusal by throwing, and /api/listings/draft turns that into a 400.
 */
export function parseListingPatch(input: unknown): Partial<ListingFormData> {
  const parsed = listingPatchSchema.safeParse(input)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`Invalid listing data — ${detail}`)
  }
  return parsed.data as Partial<ListingFormData>
}

// Per-step schemas for wizard step validation. Each is a standalone z.object
// (or a superRefine over one), so safeParse validates ONLY that step's fields and
// ignores the others. Step schemas are the right tool for per-step checks — don't
// field-scope the combined `listingSchema`, whose later-step requirements (e.g.
// photos) are still unmet while an earlier step is being validated.
export const stepSchemas: Record<number, z.ZodTypeAny> = {
  1: typeLocationSchema,
  2: financialsSchema,
  3: photosDetailsSchema,
}

// Helper to get field names for each step (used to clear a step's RHF errors).
export function getFieldsForStep(step: number): (keyof ListingFormData)[] {
  switch (step) {
    case 1:
      return ['type', 'locations']
    case 2:
      return ['askingPrice', 'ttmProfit', 'reasonForSelling']
    case 3:
      return ['photos', 'inventoryIncluded', 'laserIncluded', 'inventoryCostEstimate', 'otherAssets', 'notes']
    default:
      return []
  }
}
