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

  // Hello Sugar suites sit inside third-party salon venues, so the directory
  // address often carries the operator's name. MapTiler still resolves the right
  // street but docks relevance ~0.05, which drops it under the 0.8 accept
  // threshold — measured on the real API for the Riverton case below (0.778 with
  // "Salon" left in, 0.825 without). The row then stays ungeocoded forever and
  // never appears as a /browse map dot.
  describe("salon-venue noise", () => {
    it("strips a trailing bare brand word (UT Riverton: 0.778 -> 0.825)", () => {
      expect(
        cleanAddress("13222 Tree Sparrow Dr Suite R-220 Salon #TBD, Riverton UT 84096"),
      ).toBe("13222 Tree Sparrow Dr, Riverton UT 84096")
    })

    it("strips a brand name used as a prefix, keeping the street number", () => {
      expect(cleanAddress("Salon Lofts 1911 Falls Valley Drive, Raleigh NC 27615")).toBe(
        "1911 Falls Valley Drive, Raleigh NC 27615",
      )
      expect(
        cleanAddress("Sola Salon Studios 301 S Hills Village 3B & 10A, Pittsburgh PA 15241"),
      ).toBe("301 S Hills Village 3B, Pittsburgh PA 15241")
      expect(cleanAddress("Sola Salon Suites, 419 W. 22nd Street, Norfolk VA 23517")).toBe(
        "419 W. 22nd Street, Norfolk VA 23517",
      )
      expect(cleanAddress("My Salon Suite, 3582 29th Street, Suite 107, Kentwood, Michigan 49512")).toBe(
        "3582 29th Street, Kentwood, Michigan 49512",
      )
    })

    it("strips 'Studio NN' unit noise", () => {
      expect(cleanAddress("2626 Edgewater Drive Studio 15, Orlando, FL 32804")).toBe(
        "2626 Edgewater Drive, Orlando, FL 32804",
      )
    })

    it("strips a parenthetical venue note", () => {
      expect(
        cleanAddress("1285 East Lincoln Highway, Suite 2 (inside Sola Salon Suites), Levittown PA 19056"),
      ).toBe("1285 East Lincoln Highway, Levittown PA 19056")
    })

    it("strips 'Salons by JC' and the pipe separator", () => {
      expect(cleanAddress("1603 Boston Post Rd Salons by JC | Suite 2-3, Milford CT 06460")).toBe(
        "1603 Boston Post Rd, Milford CT 06460",
      )
    })

    it("drops dangling range connectors left by a stripped unit", () => {
      expect(
        cleanAddress("1042 Northside Dr NW Suite M210 Salon 48 & 49, Atlanta GA 30318"),
      ).toBe("1042 Northside Dr NW, Atlanta GA 30318")
      expect(
        cleanAddress("1748 Rock Prairie Rd Studios 11 and 13, College Station, TX 77845"),
      ).toBe("1748 Rock Prairie Rd, College Station, TX 77845")
    })

    // Defensive: no such row exists today, but "Studio City" and "Phenix City"
    // are real US place names and a future directory row could carry one.
    // Stripping the brand word there would destroy the city.
    it("never strips a brand word that is part of a city name", () => {
      expect(cleanAddress("4500 Ventura Canyon Ave, Studio City CA 91604")).toBe(
        "4500 Ventura Canyon Ave, Studio City CA 91604",
      )
      expect(cleanAddress("1300 Broad St, Phenix City AL 36867")).toBe(
        "1300 Broad St, Phenix City AL 36867",
      )
    })
  })

  // These three came out of probing all 48 ungeocoded addresses against the live
  // geocoder — the unit rule consumes the token after the unit word, so once
  // "#138" was stripped ahead of it the rule ate whatever came next.
  describe("a unit word must not swallow real address parts", () => {
    it("keeps the city when the unit had a '#' identifier (TX Houston | River Oaks)", () => {
      expect(cleanAddress("2034 A West Gray Suite #138 Houston, TX 77019")).toBe(
        "2034 A West Gray Houston, TX 77019",
      )
    })

    it("leaves no bare unit word behind (UT American Fork)", () => {
      expect(cleanAddress("777 Grassland Drive Suite #111, American Fork, UT 84003")).toBe(
        "777 Grassland Drive, American Fork, UT 84003",
      )
    })

    it("handles a brand word followed by a unit word (VA Virginia Beach)", () => {
      expect(
        cleanAddress("4505 Columbus St in Phenix Salon Suite 134, Virginia Beach VA 23462"),
      ).toBe("4505 Columbus St, Virginia Beach VA 23462")
    })
  })

  // Pre-existing bug found while fixing the above: "fl" was in the unit-keyword
  // list and consumed the token after it, so every Florida address lost its
  // state and ZIP ("Bradenton FL 34205" -> "Bradenton"), which geocoded to the
  // wrong ZIP entirely.
  describe("floor abbreviations vs the state of Florida", () => {
    it("keeps 'FL <zip>' intact", () => {
      expect(cleanAddress("101 Manatee Ave W Phenix Salons, Bradenton FL  34205")).toBe(
        "101 Manatee Ave W, Bradenton FL 34205",
      )
      expect(cleanAddress("12823 N Dale Mabry Hwy #6 Tampa, FL 33618")).toBe(
        "12823 N Dale Mabry Hwy Tampa, FL 33618",
      )
    })

    it("still strips ordinal floors", () => {
      expect(cleanAddress("1 Boerum Pl 2nd fl. Brooklyn, NY 11201")).toBe(
        "1 Boerum Pl Brooklyn, NY 11201",
      )
      expect(cleanAddress("1416 NW Ballard Way 3rd Floor, Studio #15, Seattle WA 98107")).toBe(
        "1416 NW Ballard Way, Seattle WA 98107",
      )
    })
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
