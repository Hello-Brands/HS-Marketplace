import { describe, it, expect } from "vitest"
import { photosDetailsSchema } from "@/lib/listings/schemas"

const validBase = {
  photos: [{ id: "1", url: "https://example.com/a.jpg", filename: "a.jpg", order: 0 }],
  inventoryIncluded: true,
  laserIncluded: false,
}

describe("photosDetailsSchema inventoryCostEstimate", () => {
  it("is optional", () => {
    expect(photosDetailsSchema.safeParse(validBase).success).toBe(true)
  })
  it("accepts a non-negative number", () => {
    expect(photosDetailsSchema.safeParse({ ...validBase, inventoryCostEstimate: 25000 }).success).toBe(true)
  })
  it("rejects a negative number", () => {
    expect(photosDetailsSchema.safeParse({ ...validBase, inventoryCostEstimate: -1 }).success).toBe(false)
  })
})
