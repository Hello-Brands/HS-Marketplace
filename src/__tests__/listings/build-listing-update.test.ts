import { describe, it, expect } from 'vitest'
import { buildListingUpdate } from '@/lib/listings/build-update'

const existing = {
  askingPrice: 20_000_000, // $200,000 in cents
  ttmProfit: 8_000_000, // $80,000 in cents
  inventoryIncluded: true,
  laserIncluded: false,
}

describe('buildListingUpdate — money normalization (dollars → cents)', () => {
  it('converts askingPrice and ttmProfit from dollars to cents', () => {
    const out = buildListingUpdate({ askingPrice: 500_000, ttmProfit: 120_000 })
    expect(out.askingPrice).toBe(50_000_000)
    expect(out.ttmProfit).toBe(12_000_000)
  })

  it('rounds fractional dollars to the nearest cent', () => {
    const out = buildListingUpdate({ askingPrice: 1234.56, ttmProfit: 19.99 })
    expect(out.askingPrice).toBe(123_456)
    expect(out.ttmProfit).toBe(1999)
  })
})

describe('buildListingUpdate — create semantics (no existing row)', () => {
  it('defaults missing money to 0 / null and flags to false', () => {
    const out = buildListingUpdate({})
    expect(out.askingPrice).toBe(0)
    expect(out.ttmProfit).toBeNull()
    expect(out.inventoryIncluded).toBe(false)
    expect(out.laserIncluded).toBe(false)
    expect(out.inventoryCostEstimate).toBeNull()
  })

  it('stores inventoryCostEstimate (in cents) only when inventory is included', () => {
    expect(
      buildListingUpdate({ inventoryIncluded: true, inventoryCostEstimate: 5_000 })
        .inventoryCostEstimate,
    ).toBe(500_000)
    // Not included → cleared to null even if a value is present.
    expect(
      buildListingUpdate({ inventoryIncluded: false, inventoryCostEstimate: 5_000 })
        .inventoryCostEstimate,
    ).toBeNull()
  })
})

describe('buildListingUpdate — partial edit falls back to the existing row', () => {
  it('keeps existing money values when data omits them (fixes DEBT-001)', () => {
    const out = buildListingUpdate({ notes: 'admin note only' }, existing)
    expect(out.askingPrice).toBe(20_000_000)
    expect(out.ttmProfit).toBe(8_000_000)
    expect(out.notes).toBe('admin note only')
  })

  it('keeps existing flags when data omits them', () => {
    const out = buildListingUpdate({}, existing)
    expect(out.inventoryIncluded).toBe(true)
    expect(out.laserIncluded).toBe(false)
  })

  it('still overrides existing values when data provides them', () => {
    const out = buildListingUpdate({ askingPrice: 300_000 }, existing)
    expect(out.askingPrice).toBe(30_000_000)
    // ttmProfit omitted → keeps existing.
    expect(out.ttmProfit).toBe(8_000_000)
  })
})
