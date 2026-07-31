import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const select = vi.fn()
const update = vi.fn()
const batch = vi.fn(async () => [])
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => select(...a),
    update: (...a: unknown[]) => update(...a),
    batch: (...a: unknown[]) => batch(...a),
  },
}))

import {
  resolveOwnerRowCoords,
  applyMondayCoordsToListings,
  mondayCoordsForBqName,
} from "@/lib/owner-directory/monday-coords"

const NOW = new Date("2026-07-31T12:00:00Z")
const coords = new Map([["284", { lat: 40.691574, lng: -73.988771 }]])

describe("resolveOwnerRowCoords", () => {
  it("applies Monday coords for a covered number, overwriting a differing prior", () => {
    const prior = {
      latitude: 1, longitude: 2,
      geocodedAt: new Date("2025-01-01"), coordSource: "maptiler",
    }
    expect(resolveOwnerRowCoords("284", prior, coords, NOW)).toEqual({
      latitude: 40.691574, longitude: -73.988771, geocodedAt: NOW, coordSource: "monday",
    })
  })

  it("trims the incoming number before lookup", () => {
    expect(resolveOwnerRowCoords(" 284 ", null, coords, NOW).coordSource).toBe("monday")
  })

  it("preserves prior coords (and their source) for an uncovered number", () => {
    const prior = {
      latitude: 35.6, longitude: -82.5,
      geocodedAt: new Date("2025-01-01"), coordSource: "maptiler",
    }
    expect(resolveOwnerRowCoords("999", prior, coords, NOW)).toEqual(prior)
  })

  it("returns all-null for an uncovered row with no prior", () => {
    expect(resolveOwnerRowCoords(null, null, coords, NOW)).toEqual({
      latitude: null, longitude: null, geocodedAt: null, coordSource: null,
    })
  })

  it("falls back to prior when the coords map is null (BigQuery failure)", () => {
    const prior = {
      latitude: 35.6, longitude: -82.5, geocodedAt: null, coordSource: null,
    }
    expect(resolveOwnerRowCoords("284", prior, null, NOW)).toEqual(prior)
  })
})

describe("applyMondayCoordsToListings", () => {
  beforeEach(() => {
    select.mockReset()
    update.mockReset()
    batch.mockReset().mockResolvedValue([])
  })

  const coordsMap = new Map([["284", { lat: 40.69, lng: -73.98 }]])

  it("updates each confirmed listing location whose bridged number has coords", async () => {
    // ll-1 appears twice (multi-owner rows sharing the resolved name); ll-2's
    // number is uncovered; ll-3's owner row has no number.
    select.mockReturnValue(
      builder([
        { id: "ll-1", num: "284" },
        { id: "ll-1", num: "284" },
        { id: "ll-2", num: "999" },
        { id: "ll-3", num: null },
      ])
    )
    const updateBuilders: ChainedBuilder[] = []
    update.mockImplementation(() => {
      const b = builder(undefined)
      updateBuilders.push(b)
      return b
    })

    const n = await applyMondayCoordsToListings(coordsMap, new Date("2026-07-31T12:00:00Z"))

    expect(n).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(updateBuilders[0].calls.set[0][0]).toMatchObject({
      latitude: 40.69,
      longitude: -73.98,
      geocodeSource: "monday",
    })
    expect(batch).toHaveBeenCalledTimes(1)
  })

  it("is a no-op (no batch call) when nothing matches", async () => {
    select.mockReturnValue(builder([{ id: "ll-2", num: "999" }]))
    expect(await applyMondayCoordsToListings(coordsMap, new Date())).toBe(0)
    expect(batch).not.toHaveBeenCalled()
  })
})

describe("mondayCoordsForBqName", () => {
  beforeEach(() => select.mockReset())

  it("returns the first owner row's covered coords (trimming the number)", async () => {
    select.mockReturnValue(builder([{ num: null }, { num: " 284 " }]))
    expect(await mondayCoordsForBqName("Sugar House", new Map([["284", { lat: 1, lng: 2 }]])))
      .toEqual({ lat: 1, lng: 2 })
  })

  it("returns null when no owner row's number is covered", async () => {
    select.mockReturnValue(builder([{ num: "999" }]))
    expect(await mondayCoordsForBqName("Sugar House", new Map())).toBeNull()
  })
})
