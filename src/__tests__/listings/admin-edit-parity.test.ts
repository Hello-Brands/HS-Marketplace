import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listingLocations, listingPhotos } from '@/db/schema/listings'

// DEBT-003: admin edits must reach full parity with the seller path — persisting
// location + photo edits, not just scalar fields. These mocks let us observe the
// delete-and-reinsert the shared sync helpers perform.

const {
  mockAuth,
  mockUpdate,
  setWhere,
  mockFindFirst,
  mockLocSnapshot,
  inserts,
  deletes,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUpdate: vi.fn(),
  setWhere: vi.fn(),
  mockFindFirst: vi.fn(),
  mockLocSnapshot: vi.fn(),
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  deletes: [] as unknown[],
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// persist.ts re-derives ttmRevenue/mcr from BigQuery instead of trusting the
// client payload; stub the cached maps so write-path tests stay offline.
vi.mock('@/lib/bigquery/queries', () => ({
  getNetSalesByLocation: vi.fn().mockResolvedValue(new Map()),
  getMcrByLocation: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/lib/email', () => ({ sendStatusChangeEmail: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/alert-actions', () => ({ triggerAlertMatching: vi.fn().mockResolvedValue(undefined) }))
// The owner directory is scoped to the signed-in user; empty is fine for this test
// (new/edited rows fall back to the prior snapshot or "unconfirmed").
vi.mock('@/lib/owner-directory/data', () => ({
  getMyOwnerLocations: vi.fn().mockResolvedValue({ locations: [] }),
}))
// Keep geo resolution offline so the test never hits the network.
vi.mock('@/lib/geocode/geocode', () => ({ geocodeAddress: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/geocode/address', () => ({ parseUsAddressTail: vi.fn().mockReturnValue(null) }))

vi.mock('@/db', () => ({
  db: {
    // saveDraft-style select isn't used here; the location snapshot uses this chain.
    select: () => ({ from: () => ({ where: mockLocSnapshot }) }),
    update: mockUpdate,
    // delete/insert now build query objects that are handed to db.batch rather than
    // awaited individually; we still record what was built here for the assertions.
    delete: (table: unknown) => ({
      where: () => {
        deletes.push(table)
        return Promise.resolve()
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values })
        return Promise.resolve()
      },
    }),
    // The sync helpers commit delete + re-inserts as one atomic neon-http batch.
    batch: (queries: unknown[]) => Promise.all(queries),
    query: { listings: { findFirst: mockFindFirst } },
  },
}))

import { adminUpdateListing } from '@/lib/admin/actions'

describe('adminUpdateListing — location & photo parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inserts.length = 0
    deletes.length = 0
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    mockUpdate.mockReturnValue({ set: vi.fn(() => ({ where: setWhere })) })
    mockFindFirst.mockResolvedValue({
      id: 'L1',
      sellerId: 'seller-1',
      title: 'Existing Salon',
      askingPrice: 20_000_000,
      ttmProfit: 8_000_000,
      inventoryIncluded: false,
      laserIncluded: false,
    })
    // No prior location rows to snapshot.
    mockLocSnapshot.mockResolvedValue([])
  })

  it('persists edited locations and photos (delete-and-reinsert)', async () => {
    await adminUpdateListing('L1', {
      askingPrice: 500_000,
      locations: [
        {
          id: 'loc-1',
          type: 'territory',
          name: 'Austin Territory',
          territoryLat: 30.26,
          territoryLng: -97.74,
          territoryRadius: 25,
        },
      ],
      photos: [{ id: 'p-1', url: 'https://cdn/p1.jpg', filename: 'p1.jpg', order: 0 }],
    })

    // Old rows cleared for both tables.
    expect(deletes).toContain(listingLocations)
    expect(deletes).toContain(listingPhotos)

    // New location row reinserted.
    const locInsert = inserts.find((i) => i.table === listingLocations)
    expect(locInsert).toBeDefined()
    expect(locInsert!.values.name).toBe('Austin Territory')
    expect(locInsert!.values.listingId).toBe('L1')

    // New photo row reinserted.
    const photoInsert = inserts.find((i) => i.table === listingPhotos)
    expect(photoInsert).toBeDefined()
    expect(photoInsert!.values.url).toBe('https://cdn/p1.jpg')

    // And the scalar money conversion still happens on the same call.
    const payload = mockUpdate.mock.results[0].value.set.mock.calls[0][0]
    expect(payload.askingPrice).toBe(50_000_000)
  })

  it('leaves locations/photos untouched when the edit omits them', async () => {
    await adminUpdateListing('L1', { notes: 'scalar only' })

    expect(deletes).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })
})
