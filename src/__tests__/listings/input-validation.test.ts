import { describe, it, expect, vi, beforeEach } from "vitest"

// Regression: neither write path validated anything server-side. The zod schemas
// in src/lib/listings/schemas.ts were wired ONLY into the client's
// react-hook-form resolver, so every type, range and max-length constraint was
// bypassed by invoking saveDraft/adminUpdateListing directly, or by posting to
// /api/listings/draft (which passes `await request.json()` straight through).
//
// The other half of this is that validation must NOT be so strict that it
// rejects legitimate in-progress drafts — a draft has no photos, often no price,
// and possibly no locations yet. An over-strict schema here would re-break the
// seller flow, which was a Blocker in a previous audit.

const { mockAuth, mockSelect } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockSelect: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth: mockAuth }))
// Pass-through unstable_cache: persist.ts now transitively loads
// src/lib/bigquery/queries.ts, which wraps its fetchers at module scope.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    update: vi.fn(),
    batch: vi.fn(),
    query: { listings: { findFirst: vi.fn() } },
  },
}))

import { parseListingPatch } from "@/lib/listings/schemas"
import { saveDraft } from "@/lib/listings/actions"

describe("parseListingPatch: rejects what the client resolver used to be the only guard for", () => {
  it("rejects a notes field over its 2000-character maximum", () => {
    expect(() => parseListingPatch({ notes: "x".repeat(2001) })).toThrow(/Invalid listing data/)
  })

  it("rejects an otherAssets field over its 500-character maximum", () => {
    expect(() => parseListingPatch({ otherAssets: "x".repeat(501) })).toThrow(/Invalid listing data/)
  })

  it("rejects a listing type outside the enum", () => {
    expect(() => parseListingPatch({ type: "megaplex" })).toThrow(/Invalid listing data/)
  })

  it("rejects more than 10 photos", () => {
    const photos = Array.from({ length: 11 }, (_, i) => ({
      id: `p${i}`,
      url: "https://example.com/p.jpg",
      filename: "p.jpg",
      order: i,
    }))
    expect(() => parseListingPatch({ photos })).toThrow(/Maximum 10 photos/)
  })

  it("rejects a non-numeric askingPrice", () => {
    expect(() => parseListingPatch({ askingPrice: "free" })).toThrow(/Invalid listing data/)
  })

  it("rejects a negative askingPrice", () => {
    expect(() => parseListingPatch({ askingPrice: -5 })).toThrow(/Invalid listing data/)
  })

  it("rejects a photo url that is not a url", () => {
    expect(() =>
      parseListingPatch({
        photos: [{ id: "p1", url: "not-a-url", filename: "p.jpg", order: 0 }],
      }),
    ).toThrow(/Invalid listing data/)
  })

  it("names the offending field in the error", () => {
    expect(() => parseListingPatch({ notes: "x".repeat(2001) })).toThrow(/notes/)
  })
})

describe("parseListingPatch: still accepts legitimate in-progress drafts", () => {
  it("accepts an empty patch", () => {
    expect(parseListingPatch({})).toEqual({})
  })

  it("accepts a draft with no photos, no price and no locations", () => {
    expect(parseListingPatch({ type: "suite" })).toEqual({ type: "suite" })
  })

  it("accepts askingPrice 0 while the seller is still typing", () => {
    // `.positive()` is enforced at submit time by listingSchema, not on drafts.
    expect(parseListingPatch({ askingPrice: 0 })).toEqual({ askingPrice: 0 })
  })

  it("accepts an empty locations array", () => {
    expect(parseListingPatch({ locations: [] })).toEqual({ locations: [] })
  })

  it("accepts a realistic step-1 draft payload", () => {
    const draft = {
      type: "suite" as const,
      locations: [
        { id: "ol-1", type: "salon" as const, name: "Austin Domain", address: "123 Domain Dr" },
      ],
    }
    expect(parseListingPatch(draft)).toMatchObject(draft)
  })
})

describe("parseListingPatch: normalizes the JSON API route's payload", () => {
  it("coerces an ISO date string to a Date (the /api/listings/draft path)", () => {
    const parsed = parseListingPatch({
      locations: [
        {
          id: "ol-1",
          type: "salon",
          name: "Austin Domain",
          openingDate: "2024-03-01T00:00:00.000Z",
        },
      ],
    })
    const openingDate = parsed.locations?.[0]?.openingDate
    expect(openingDate).toBeInstanceOf(Date)
    expect((openingDate as Date).toISOString()).toBe("2024-03-01T00:00:00.000Z")
  })

  it("strips unknown keys instead of passing them downstream", () => {
    const parsed = parseListingPatch({
      notes: "fine",
      sellerId: "someone-else",
      status: "active",
      id: "forged-id",
    }) as Record<string, unknown>

    expect(parsed.notes).toBe("fine")
    expect(parsed.sellerId).toBeUndefined()
    expect(parsed.status).toBeUndefined()
    expect(parsed.id).toBeUndefined()
  })
})

describe("saveDraft rejects invalid input before touching the database", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "seller-1", role: "user", sellerAccess: true } })
  })

  it("throws on an over-long notes field and never queries", async () => {
    await expect(saveDraft({ notes: "x".repeat(2001) } as never, "listing-1")).rejects.toThrow(
      /Invalid listing data/,
    )
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it("throws on a bogus listing type and never queries", async () => {
    await expect(saveDraft({ type: "megaplex" } as never)).rejects.toThrow(/Invalid listing data/)
    expect(mockSelect).not.toHaveBeenCalled()
  })
})
