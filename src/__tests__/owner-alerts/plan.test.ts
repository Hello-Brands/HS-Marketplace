import { describe, it, expect } from "vitest"
import { planOwnerAutoAlerts } from "@/lib/owner-alerts/plan"

const loc = (ownerIdentifier: string, locationName: string, latitude: number | null, longitude: number | null) => ({
  ownerIdentifier, locationName, latitude, longitude,
})
const alertRow = (id: string, ownerIdentifier: string | null, ownerLocationName: string | null, centerLat: number | null, centerLng: number | null) => ({
  id, ownerIdentifier, ownerLocationName, centerLat, centerLng,
})

describe("planOwnerAutoAlerts", () => {
  it("creates alerts only for owned locations that have coordinates", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.725, -111.86), loc("own1", "No Coords", null, null)],
      []
    )
    expect(plan.toCreate).toEqual([
      { ownerIdentifier: "own1", locationName: "Sugar House", latitude: 40.725, longitude: -111.86 },
    ])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toDelete).toEqual([])
  })

  it("is a no-op when the alert already matches", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.725, -111.86)],
      [alertRow("a1", "own1", "Sugar House", 40.725, -111.86)]
    )
    expect(plan).toEqual({ toCreate: [], toUpdate: [], toDelete: [] })
  })

  it("refreshes drifted coordinates", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.9, -111.9)],
      [alertRow("a1", "own1", "Sugar House", 40.725, -111.86)]
    )
    expect(plan.toUpdate).toEqual([
      { id: "a1", latitude: 40.9, longitude: -111.9, locationName: "Sugar House" },
    ])
  })

  it("keeps the old center when a location LOSES its coordinates", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", null, null)],
      [alertRow("a1", "own1", "Sugar House", 40.725, -111.86)]
    )
    expect(plan).toEqual({ toCreate: [], toUpdate: [], toDelete: [] })
  })

  it("deletes alerts for locations the user no longer owns (revocation)", () => {
    const plan = planOwnerAutoAlerts([], [alertRow("a1", "own1", "Sugar House", 40.725, -111.86)])
    expect(plan.toDelete).toEqual(["a1"])
  })

  it("deletes duplicate rows for one pair and reconciles the survivor", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.9, -111.9)],
      [
        alertRow("dupe", "own1", "Sugar House", 40.725, -111.86),
        alertRow("keep", "own1", "Sugar House", 40.725, -111.86),
      ]
    )
    expect(plan.toDelete).toEqual(["dupe"])
    expect(plan.toCreate).toEqual([])
    // the survivor is still reconciled: drifted coords get refreshed
    expect(plan.toUpdate).toEqual([
      { id: "keep", latitude: 40.9, longitude: -111.9, locationName: "Sugar House" },
    ])
  })

  it("does not confuse pairs whose owner identifier contains a space", () => {
    const plan = planOwnerAutoAlerts(
      [loc("Unknown Owner", "Sugar House", 40.725, -111.86)],
      [alertRow("a1", "Unknown", "Owner Sugar House", 40.725, -111.86)]
    )
    expect(plan.toDelete).toEqual(["a1"])
    expect(plan.toCreate).toEqual([
      { ownerIdentifier: "Unknown Owner", locationName: "Sugar House", latitude: 40.725, longitude: -111.86 },
    ])
  })

  it("deletes malformed owner-auto rows missing their soft reference", () => {
    const plan = planOwnerAutoAlerts(
      [loc("own1", "Sugar House", 40.725, -111.86)],
      [alertRow("bad", null, null, 40.0, -111.0), alertRow("a1", "own1", "Sugar House", 40.725, -111.86)]
    )
    expect(plan.toDelete).toEqual(["bad"])
  })
})
