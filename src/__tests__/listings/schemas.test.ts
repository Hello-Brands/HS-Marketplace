import { describe, it, expect } from 'vitest'
import { typeLocationSchema, financialsSchema, photosDetailsSchema, listingSchema, stepSchemas } from '@/lib/listings/schemas'

describe('typeLocationSchema', () => {
  it('rejects empty locations array', () => {
    const result = typeLocationSchema.safeParse({
      type: 'suite',
      locations: [],
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid suite with location', () => {
    const result = typeLocationSchema.safeParse({
      type: 'suite',
      locations: [{ id: '1', type: 'salon', name: 'Test Salon' }],
    })
    expect(result.success).toBe(true)
  })

  it('requires territory fields for territory type', () => {
    const result = typeLocationSchema.safeParse({
      type: 'territory',
      locations: [{ id: '1', type: 'territory', name: 'Test Territory' }], // missing lat/lng/radius
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid territory with all required fields', () => {
    const result = typeLocationSchema.safeParse({
      type: 'territory',
      locations: [{
        id: '1',
        type: 'territory',
        name: 'Test Territory',
        territoryLat: 33.749,
        territoryLng: -84.388,
        territoryRadius: 5000,
      }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid listing type', () => {
    const result = typeLocationSchema.safeParse({
      type: 'invalid',
      locations: [{ id: '1', type: 'salon', name: 'Test Salon' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('financialsSchema', () => {
  it('requires positive askingPrice', () => {
    const result = financialsSchema.safeParse({ askingPrice: -100 })
    expect(result.success).toBe(false)
  })

  it('rejects zero askingPrice', () => {
    const result = financialsSchema.safeParse({ askingPrice: 0 })
    expect(result.success).toBe(false)
  })

  it('accepts valid financials', () => {
    const result = financialsSchema.safeParse({ askingPrice: 50000 })
    expect(result.success).toBe(true)
  })

  it('accepts financials with optional fields', () => {
    const result = financialsSchema.safeParse({
      askingPrice: 75000,
      ttmProfit: 30000,
      reasonForSelling: 'Relocating to another state',
    })
    expect(result.success).toBe(true)
  })

  it('rejects reasonForSelling over 500 characters', () => {
    const result = financialsSchema.safeParse({
      askingPrice: 50000,
      reasonForSelling: 'a'.repeat(501),
    })
    expect(result.success).toBe(false)
  })
})

describe('photosDetailsSchema', () => {
  const validPhoto = {
    id: '1',
    url: 'https://example.com/photo.jpg',
    filename: 'photo.jpg',
    order: 0,
  }

  it('requires at least 1 photo', () => {
    const result = photosDetailsSchema.safeParse({
      photos: [],
      inventoryIncluded: false,
      laserIncluded: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects more than 10 photos', () => {
    const photos = Array.from({ length: 11 }, (_, i) => ({
      id: `${i}`,
      url: `https://example.com/${i}.jpg`,
      filename: `${i}.jpg`,
      order: i,
    }))
    const result = photosDetailsSchema.safeParse({
      photos,
      inventoryIncluded: false,
      laserIncluded: false,
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid photos and details', () => {
    const result = photosDetailsSchema.safeParse({
      photos: [validPhoto],
      inventoryIncluded: true,
      laserIncluded: false,
    })
    expect(result.success).toBe(true)
  })

  it('accepts exactly 10 photos', () => {
    const photos = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`,
      url: `https://example.com/${i}.jpg`,
      filename: `${i}.jpg`,
      order: i,
    }))
    const result = photosDetailsSchema.safeParse({
      photos,
      inventoryIncluded: false,
      laserIncluded: false,
    })
    expect(result.success).toBe(true)
  })
})

// Regression for the seller-wizard Blocker (pre-launch audit 2026-07-06): advancing
// past the Financials step re-validated the whole `.and()` intersection — including
// Step 3's still-empty `photos` — so the wizard silently stuck at Step 2. Per-step
// validation must use each step's OWN schema, which ignores other steps' fields.
describe('per-step wizard validation (stepSchemas)', () => {
  // A realistic mid-wizard form value: Steps 1 & 2 filled, Step 3 not reached yet.
  const midWizardValues = {
    type: 'suite',
    locations: [{ id: '1', type: 'salon', name: 'Test Salon' }],
    askingPrice: 250000,
    photos: [], // still empty at Step 2 — this is the crux
    inventoryIncluded: false,
    laserIncluded: false,
  }

  it('Step 2 schema PASSES with a valid price even though photos is still empty', () => {
    expect(stepSchemas[2].safeParse(midWizardValues).success).toBe(true)
  })

  it('Step 1 schema passes on the same mid-wizard values', () => {
    expect(stepSchemas[1].safeParse(midWizardValues).success).toBe(true)
  })

  it('the combined intersection FAILS on those same values (why we must not field-scope it per step)', () => {
    expect(listingSchema.safeParse(midWizardValues).success).toBe(false)
  })

  it('Step 3 schema still enforces at-least-one-photo', () => {
    expect(stepSchemas[3].safeParse(midWizardValues).success).toBe(false)
    expect(stepSchemas[3].safeParse({ ...midWizardValues, photos: [{ id: '1', url: 'https://example.com/p.jpg', filename: 'p.jpg', order: 0 }] }).success).toBe(true)
  })
})
