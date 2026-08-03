import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression: ttmRevenue and mcr must be re-derived server-side from BigQuery,
// never taken from the client payload.
//
// Both fields are display-only in the wizard (LocationSelector / FinancialsStep
// render them; no input is bound to either), but they still round-trip through
// client form state — so before this guard a seller, or anyone POSTing the
// server action directly, could attach arbitrary "verified" revenue and
// conversion figures to a listing. Those are the exact numbers the listing card
// presents as verified from Hello Sugar's own reporting.
//
// buildLocationInserts is the single choke point for BOTH write paths: the
// seller path (saveDraft -> buildLocationInserts / buildLocationSync) and the
// admin path (adminUpdateListing -> buildLocationSync -> buildLocationInserts).

const { inserts, mockGetOwnerLocations, mockNetSales, mockMcr } = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  mockGetOwnerLocations: vi.fn(),
  mockNetSales: vi.fn(),
  mockMcr: vi.fn(),
}))

vi.mock('@/db', () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v)
        return { __insert: true }
      },
    }),
  },
}))
vi.mock('@/lib/owner-directory/data', () => ({ getMyOwnerLocations: mockGetOwnerLocations }))
vi.mock('@/lib/bigquery/queries', () => ({
  getNetSalesByLocation: mockNetSales,
  getMcrByLocation: mockMcr,
}))
// Keep geocoding offline and best-effort (null = no coords, never throws).
vi.mock('@/lib/geocode/geocode', () => ({ geocodeAddress: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/geocode/address', () => ({ parseUsAddressTail: vi.fn().mockReturnValue(null) }))

import { buildLocationInserts } from '@/lib/listings/persist'

// The seller's submitted payload, with financials they should not control.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const forgedLocation: any = {
  type: 'salon',
  name: 'Austin Domain',
  address: '123 Domain Dr, Austin TX 78758',
  ttmRevenue: 99_999_999, // forged: ~$1M in cents
  mcr: 0.99, // forged: 99% conversion
}

function ownerDirectoryRow(confidence: 'high' | 'low') {
  return {
    id: 'ol-1',
    blvdLocationName: 'Austin Domain',
    resolvedBqLocationName: 'AUSTIN DOMAIN',
    blvdMatchConfidence: confidence,
    locationAddress: '123 Domain Dr',
    blvdLocationNumber: null,
    actualFlagshipGoDate: null,
    actualSuiteGoDate: null,
  }
}

describe('buildLocationInserts financial derivation', () => {
  beforeEach(() => {
    inserts.length = 0
    vi.clearAllMocks()
  })

  it('ignores client-supplied ttmRevenue/mcr and writes the BigQuery values', async () => {
    mockGetOwnerLocations.mockResolvedValue({ locations: [ownerDirectoryRow('high')] })
    // BigQuery is the source of truth, keyed on resolvedBqLocationName.
    mockNetSales.mockResolvedValue(new Map([['AUSTIN DOMAIN', { totalCents: 4_200_000 }]]))
    mockMcr.mockResolvedValue(new Map([['AUSTIN DOMAIN', 34.5]]))

    await buildLocationInserts('listing-1', [forgedLocation], new Map())

    expect(inserts).toHaveLength(1)
    const row = inserts[0]
    expect(row.ttmRevenue).toBe(4_200_000)
    // BigQuery reports MCR as a percentage; the column stores a fraction.
    expect(row.mcr).toBeCloseTo(0.345)
    // The forged values must not survive anywhere.
    expect(row.ttmRevenue).not.toBe(99_999_999)
    expect(row.mcr).not.toBe(0.99)
  })

  it('writes null financials when the location has no resolved BigQuery name', async () => {
    // Not the owner's location at all — no directory match, so no join key.
    mockGetOwnerLocations.mockResolvedValue({ locations: [] })
    mockNetSales.mockResolvedValue(new Map([['AUSTIN DOMAIN', { totalCents: 4_200_000 }]]))
    mockMcr.mockResolvedValue(new Map([['AUSTIN DOMAIN', 34.5]]))

    await buildLocationInserts('listing-1', [forgedLocation], new Map())

    const row = inserts[0]
    expect(row.bqLocationName).toBeNull()
    expect(row.ttmRevenue).toBeNull()
    expect(row.mcr).toBeNull()
  })

  it('writes null financials when BigQuery has no row for the resolved name', async () => {
    mockGetOwnerLocations.mockResolvedValue({ locations: [ownerDirectoryRow('high')] })
    mockNetSales.mockResolvedValue(new Map())
    mockMcr.mockResolvedValue(new Map())

    await buildLocationInserts('listing-1', [forgedLocation], new Map())

    const row = inserts[0]
    expect(row.bqLocationName).toBe('AUSTIN DOMAIN')
    expect(row.ttmRevenue).toBeNull()
    expect(row.mcr).toBeNull()
  })

  it('follows a preserved admin mapping when deriving financials on edit', async () => {
    // On an edit the prior row's mapping decision wins as the join key, so the
    // financials must follow THAT name, not a fresh directory guess.
    mockGetOwnerLocations.mockResolvedValue({ locations: [ownerDirectoryRow('high')] })
    mockNetSales.mockResolvedValue(new Map([['ADMIN CONFIRMED NAME', { totalCents: 777_000 }]]))
    mockMcr.mockResolvedValue(new Map([['ADMIN CONFIRMED NAME', 20]]))

    const prior = new Map([
      [
        'austin domain',
        {
          bqLocationName: 'ADMIN CONFIRMED NAME',
          dataMappingStatus: 'confirmed' as const,
          city: null,
          state: null,
          zipCode: null,
          latitude: null,
          longitude: null,
          geocodedAt: null,
          geocodeSource: null,
        },
      ],
    ])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await buildLocationInserts('listing-1', [forgedLocation], prior as any)

    const row = inserts[0]
    expect(row.bqLocationName).toBe('ADMIN CONFIRMED NAME')
    expect(row.ttmRevenue).toBe(777_000)
    expect(row.mcr).toBeCloseTo(0.2)
  })
})
