import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

// Hoisted so the vi.mock factories (which vitest lifts to the top of the file)
// can reference these fns without tripping the const TDZ.
const { auth, update, getMondayCoordsByLocationNumber, mondayCoordsForBqName } = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  getMondayCoordsByLocationNumber: vi.fn(),
  mondayCoordsForBqName: vi.fn(),
}))

vi.mock("@/auth", () => ({ auth }))

vi.mock("@/db", () => ({ db: { update: (...a: unknown[]) => update(...a) } }))

vi.mock("@/lib/bigquery/queries", () => ({ getMondayCoordsByLocationNumber }))

vi.mock("@/lib/owner-directory/monday-coords", () => ({ mondayCoordsForBqName }))

import { setLocationMapping } from "@/lib/data/mapping-actions"

describe("setLocationMapping", () => {
  let updateBuilder: ChainedBuilder

  beforeEach(() => {
    auth.mockReset().mockResolvedValue({ user: { role: "admin" } })
    update.mockReset()
    updateBuilder = builder(undefined)
    update.mockReturnValue(updateBuilder)
    getMondayCoordsByLocationNumber.mockReset()
    mondayCoordsForBqName.mockReset()
  })

  it("rejects non-admins without touching the DB", async () => {
    auth.mockResolvedValue({ user: { role: "user" } })
    expect(await setLocationMapping("ll-1", { bqLocationName: "X", status: "confirmed" }))
      .toEqual({ ok: false, error: "Admin access required" })
    expect(update).not.toHaveBeenCalled()
  })

  it("still requires a location name to confirm", async () => {
    expect(await setLocationMapping("ll-1", { bqLocationName: null, status: "confirmed" }))
      .toEqual({ ok: false, error: "A location is required to confirm." })
    expect(update).not.toHaveBeenCalled()
  })

  it("stamps Monday coords when confirming a covered location", async () => {
    const coords = new Map([["284", { lat: 40.69, lng: -73.98 }]])
    getMondayCoordsByLocationNumber.mockResolvedValue(coords)
    mondayCoordsForBqName.mockResolvedValue({ lat: 40.69, lng: -73.98 })

    expect(await setLocationMapping("ll-1", { bqLocationName: "Sugar House", status: "confirmed" }))
      .toEqual({ ok: true })
    expect(mondayCoordsForBqName).toHaveBeenCalledWith("Sugar House", coords)
    expect(updateBuilder.calls.set[0][0]).toMatchObject({
      bqLocationName: "Sugar House",
      dataMappingStatus: "confirmed",
      latitude: 40.69,
      longitude: -73.98,
      geocodeSource: "monday",
    })
  })

  it("confirms without coords when the coords fetch fails", async () => {
    getMondayCoordsByLocationNumber.mockResolvedValue(null)
    expect(await setLocationMapping("ll-1", { bqLocationName: "Sugar House", status: "confirmed" }))
      .toEqual({ ok: true })
    expect(mondayCoordsForBqName).not.toHaveBeenCalled()
    const set = updateBuilder.calls.set[0][0] as Record<string, unknown>
    expect(set).toMatchObject({ bqLocationName: "Sugar House", dataMappingStatus: "confirmed" })
    expect(set).not.toHaveProperty("latitude")
  })

  it("confirms without coords when the lookup throws", async () => {
    getMondayCoordsByLocationNumber.mockRejectedValue(new Error("bq down"))
    expect(await setLocationMapping("ll-1", { bqLocationName: "Sugar House", status: "confirmed" }))
      .toEqual({ ok: true })
    expect((updateBuilder.calls.set[0][0] as Record<string, unknown>)).not.toHaveProperty("latitude")
  })

  it("never queries BigQuery for not_connected", async () => {
    expect(await setLocationMapping("ll-1", { bqLocationName: null, status: "not_connected" }))
      .toEqual({ ok: true })
    expect(getMondayCoordsByLocationNumber).not.toHaveBeenCalled()
  })
})
