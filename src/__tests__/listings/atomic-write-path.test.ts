import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listings, listingLocations, listingPhotos } from '@/db/schema/listings'

// DEBT-027: the listing write path must be atomic. A new listing (parent row +
// location rows + photo rows) and an edit's delete-and-reinsert each have to commit
// as ONE neon-http batch (a single BEGIN/…/COMMIT transaction) rather than a series
// of separately-awaited db.insert/db.delete statements — otherwise a mid-sequence
// failure leaves partial data. These tests lock in "one atomic batch, not N awaits".

const {
  mockAuth,
  mockSelect,
  mockUpdate,
  setWhere,
  mockBatch,
  mockHasAck,
  inserts,
  deletes,
  awaitedInserts,
  awaitedDeletes,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  setWhere: vi.fn(),
  mockBatch: vi.fn(),
  mockHasAck: vi.fn(),
  // Every query object built (whether or not it ends up in a batch).
  inserts: [] as { table: unknown; values: Record<string, unknown> }[],
  deletes: [] as unknown[],
  // Whether any insert/delete was awaited on its own (the anti-pattern we forbid).
  awaitedInserts: { count: 0 },
  awaitedDeletes: { count: 0 },
}))

vi.mock('@/auth', () => ({ auth: mockAuth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// persist.ts re-derives ttmRevenue/mcr from BigQuery instead of trusting the
// client payload; stub the cached maps so write-path tests stay offline.
vi.mock('@/lib/bigquery/queries', () => ({
  getNetSalesByLocation: vi.fn().mockResolvedValue(new Map()),
  getMcrByLocation: vi.fn().mockResolvedValue(new Map()),
}))
// DEBT-022: the create path enforces the seller disclaimer server-side. Mock the
// helper so create tests can opt in (acknowledged) or assert the guard rejects.
vi.mock('@/lib/listings/disclaimer', () => ({ hasAcknowledgedCurrentFdd: mockHasAck }))
vi.mock('@/lib/owner-directory/data', () => ({
  getMyOwnerLocations: vi.fn().mockResolvedValue({ locations: [] }),
}))
// Keep geocoding offline and best-effort (null = no coords, never throws).
vi.mock('@/lib/geocode/geocode', () => ({ geocodeAddress: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/geocode/address', () => ({ parseUsAddressTail: vi.fn().mockReturnValue(null) }))

// A built query object is a thenable so that IF the code ever awaited it directly
// (the non-atomic anti-pattern) we'd both execute it and count it. Inside db.batch
// the object is just collected, so its .then is never invoked.
function makeInsert(table: unknown, values: Record<string, unknown>) {
  const rec = { table, values }
  inserts.push(rec)
  return {
    __kind: 'insert' as const,
    rec,
    then(resolve: (v: unknown) => unknown) {
      awaitedInserts.count++
      return Promise.resolve(rec).then(resolve)
    },
  }
}
function makeDelete(table: unknown) {
  deletes.push(table)
  return {
    __kind: 'delete' as const,
    table,
    then(resolve: (v: unknown) => unknown) {
      awaitedDeletes.count++
      return Promise.resolve(table).then(resolve)
    },
  }
}

vi.mock('@/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    update: mockUpdate,
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => makeInsert(table, values),
    }),
    delete: (table: unknown) => ({ where: () => makeDelete(table) }),
    batch: mockBatch,
  },
}))

import { saveDraft } from '@/lib/listings/actions'

beforeEach(() => {
  vi.clearAllMocks()
  inserts.length = 0
  deletes.length = 0
  awaitedInserts.count = 0
  awaitedDeletes.count = 0
  mockAuth.mockResolvedValue({ user: { id: 'seller-1', role: 'user', sellerAccess: true } })
  mockUpdate.mockReturnValue({ set: vi.fn(() => ({ where: setWhere })) })
  // The parent-listing update is a real batch item on the edit path — give it a
  // recognizable tag so the update-path tests can assert it rides in the same batch
  // as the location/photo delete+reinserts (rather than being a separate await).
  setWhere.mockReturnValue({ __kind: 'update', table: listings })
  mockBatch.mockResolvedValue([])
  // Default: the seller has acknowledged the current FDD (create is allowed).
  mockHasAck.mockResolvedValue(true)
})

describe('saveDraft create path — atomic batch', () => {
  it('commits the listing + location + photo inserts in ONE db.batch, not separate awaits', async () => {
    const result = await saveDraft({
      askingPrice: 100_000,
      locations: [
        {
          id: 'loc-1',
          type: 'territory',
          name: 'Austin Territory',
          territoryLat: 30.26,
          territoryLng: -97.74,
          territoryRadius: 25,
        },
        {
          id: 'loc-2',
          type: 'territory',
          name: 'Dallas Territory',
          territoryLat: 32.78,
          territoryLng: -96.8,
          territoryRadius: 25,
        },
      ],
      photos: [
        { id: 'p-1', url: 'https://cdn/p1.jpg', filename: 'p1.jpg', order: 0 },
        { id: 'p-2', url: 'https://cdn/p2.jpg', filename: 'p2.jpg', order: 1 },
      ],
    })

    expect(result.success).toBe(true)

    // Exactly one atomic write happened...
    expect(mockBatch).toHaveBeenCalledTimes(1)
    // ...and nothing was inserted outside of it (no N sequential awaits).
    expect(awaitedInserts.count).toBe(0)
    expect(awaitedDeletes.count).toBe(0)

    // The single batch carries the parent listing + both locations + both photos.
    const batched = mockBatch.mock.calls[0][0] as { rec?: { table: unknown } }[]
    const tables = batched.map((q) => q.rec?.table)
    expect(batched).toHaveLength(5)
    expect(tables.filter((t) => t === listings)).toHaveLength(1)
    expect(tables.filter((t) => t === listingLocations)).toHaveLength(2)
    expect(tables.filter((t) => t === listingPhotos)).toHaveLength(2)

    // Parent + children agree on the app-generated id (no cross-query dependency).
    const listingRow = batched.find((q) => q.rec?.table === listings)!.rec!.values as {
      id: string
    }
    expect(listingRow.id).toBe(result.listingId)
    for (const q of batched) {
      if (q.rec?.table === listings) continue
      expect((q.rec!.values as { listingId: string }).listingId).toBe(result.listingId)
    }
  })

  it('does not issue any partial write when the atomic batch rejects', async () => {
    mockBatch.mockRejectedValueOnce(new Error('write conflict'))

    await expect(
      saveDraft({
        askingPrice: 100_000,
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
      }),
    ).rejects.toThrow('write conflict')

    // The one atomic call is where everything lives — nothing escaped it as a
    // standalone awaited insert that could have partially committed.
    expect(mockBatch).toHaveBeenCalledTimes(1)
    expect(awaitedInserts.count).toBe(0)
    expect(awaitedDeletes.count).toBe(0)
  })
})

// DEBT-022: the "Selling Your Franchise" disclaimer is enforced server-side on the
// create path — not just by the client gate. A seller who never acknowledged (e.g.
// calls the create action directly) must be rejected before any write happens.
describe('saveDraft create path — disclaimer gate', () => {
  it('rejects creating a new listing when the seller has not acknowledged the FDD', async () => {
    mockHasAck.mockResolvedValue(false)

    await expect(
      saveDraft({
        askingPrice: 100_000,
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
      }),
    ).rejects.toThrow('acknowledge the seller disclaimer')

    // The guard runs BEFORE any persistence — nothing was written.
    expect(mockHasAck).toHaveBeenCalledWith('seller-1')
    expect(mockBatch).not.toHaveBeenCalled()
    expect(awaitedInserts.count).toBe(0)
  })

  it('allows creating a new listing once the seller has acknowledged the FDD', async () => {
    mockHasAck.mockResolvedValue(true)

    const result = await saveDraft({
      askingPrice: 100_000,
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
    })

    expect(result.success).toBe(true)
    expect(mockHasAck).toHaveBeenCalledWith('seller-1')
    expect(mockBatch).toHaveBeenCalledTimes(1)
  })
})

describe('saveDraft update path — atomic batch', () => {
  const editPayload = {
    askingPrice: 100_000,
    locations: [
      {
        id: 'loc-1',
        type: 'territory' as const,
        name: 'Austin Territory',
        territoryLat: 30.26,
        territoryLng: -97.74,
        territoryRadius: 25,
      },
    ],
    photos: [{ id: 'p-1', url: 'https://cdn/p1.jpg', filename: 'p1.jpg', order: 0 }],
  }

  it('commits the parent update + location delete/reinserts + photo delete/reinserts in ONE db.batch', async () => {
    // Ownership lookup (existing listing) then the location snapshot select.
    mockSelect
      .mockResolvedValueOnce([{ id: 'L1', sellerId: 'seller-1', status: 'draft' }])
      .mockResolvedValueOnce([])

    await saveDraft(editPayload, 'L1')

    // db.update was called to BUILD the parent-update query, but it was NOT awaited on
    // its own — it rides in the single batch with the location + photo syncs.
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockBatch).toHaveBeenCalledTimes(1)
    // Nothing escaped the batch as a standalone awaited delete/insert.
    expect(awaitedDeletes.count).toBe(0)
    expect(awaitedInserts.count).toBe(0)

    const batched = mockBatch.mock.calls[0][0] as {
      __kind?: string
      table?: unknown
      rec?: { table: unknown }
    }[]
    // Parent update first, then the location + photo delete/reinserts. One atomic write:
    // parent update (1) + location delete (1) + location insert (1) + photo delete (1) +
    // photo insert (1) = 5 statements.
    expect(batched).toHaveLength(5)
    expect(batched[0].__kind).toBe('update')
    expect(batched[0].table).toBe(listings)

    const deletesInBatch = batched.filter((q) => q.__kind === 'delete')
    expect(deletesInBatch.map((q) => q.table)).toEqual([listingLocations, listingPhotos])

    const insertsInBatch = batched.filter((q) => q.__kind === 'insert')
    expect(insertsInBatch.map((q) => q.rec?.table)).toEqual([listingLocations, listingPhotos])
  })

  it('does not issue any partial write when the edit batch rejects', async () => {
    mockSelect
      .mockResolvedValueOnce([{ id: 'L1', sellerId: 'seller-1', status: 'draft' }])
      .mockResolvedValueOnce([])
    mockBatch.mockRejectedValueOnce(new Error('write conflict'))

    await expect(saveDraft(editPayload, 'L1')).rejects.toThrow('write conflict')

    // The one atomic call is where everything lives — the parent update, location, and
    // photo statements share a single batch, so a mid-sequence failure commits nothing.
    expect(mockBatch).toHaveBeenCalledTimes(1)
    expect(awaitedInserts.count).toBe(0)
    expect(awaitedDeletes.count).toBe(0)
  })
})
