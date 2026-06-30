import { describe, it, expect } from "vitest"
import { cleanAddress, parseUsAddressTail } from "@/lib/geocode/address"

describe("cleanAddress", () => {
  it("strips #unit and suite noise but keeps street + city/state/zip", () => {
    expect(
      cleanAddress("1051 Glendon Avenue #111, Suites 108/109, Los Angeles CA 90024"),
    ).toBe("1051 Glendon Avenue, Los Angeles CA 90024")
  })

  it("strips a single 'Suite NNN' fragment", () => {
    expect(cleanAddress("626 Broadway Suite 114, Santa Monica CA 90401")).toBe(
      "626 Broadway, Santa Monica CA 90401",
    )
  })

  it("handles Ste/Unit/Floor variants", () => {
    expect(cleanAddress("12 Main St Ste 5, Reno NV 89501")).toBe("12 Main St, Reno NV 89501")
    expect(cleanAddress("9 Oak Ave Unit B, Austin TX 78701")).toBe("9 Oak Ave, Austin TX 78701")
  })

  it("leaves a clean address unchanged", () => {
    expect(cleanAddress("100 First St, Denver CO 80202")).toBe("100 First St, Denver CO 80202")
  })
})

describe("parseUsAddressTail", () => {
  it("parses city, two-letter state, and zip from the tail", () => {
    expect(
      parseUsAddressTail("1051 Glendon Avenue #111, Suites 108/109, Los Angeles CA 90024"),
    ).toEqual({ city: "Los Angeles", state: "CA", zipCode: "90024" })
  })

  it("uppercases the state and handles a single comma", () => {
    expect(parseUsAddressTail("626 Broadway, santa monica ca 90401")).toEqual({
      city: "santa monica",
      state: "CA",
      zipCode: "90401",
    })
  })

  it("accepts ZIP+4", () => {
    expect(parseUsAddressTail("1 A St, Reno NV 89501-1234")).toEqual({
      city: "Reno",
      state: "NV",
      zipCode: "89501",
    })
  })

  it("returns null when the tail isn't a City ST ZIP", () => {
    expect(parseUsAddressTail("just a name with no location")).toBeNull()
    expect(parseUsAddressTail("")).toBeNull()
  })
})
