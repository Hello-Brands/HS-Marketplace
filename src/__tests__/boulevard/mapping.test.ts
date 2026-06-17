import { describe, it, expect } from "vitest"
import { unresolvedSalonLocations } from "@/lib/boulevard/mapping"

const rows = [
  { id: "l1", name: "A", locationType: "salon", boulevardMappingStatus: "confirmed" },
  { id: "l2", name: "B", locationType: "salon", boulevardMappingStatus: "unconfirmed" },
  { id: "l3", name: "T", locationType: "territory", boulevardMappingStatus: "unconfirmed" },
  { id: "l4", name: "C", locationType: "salon", boulevardMappingStatus: "not_connected" },
]

describe("unresolvedSalonLocations", () => {
  it("returns only unconfirmed SALON locations (territory + resolved exempt)", () => {
    expect(unresolvedSalonLocations(rows).map((r) => r.id)).toEqual(["l2"])
  })
  it("returns empty when all salon locations are resolved", () => {
    expect(unresolvedSalonLocations([rows[0], rows[2], rows[3]])).toEqual([])
  })
})
