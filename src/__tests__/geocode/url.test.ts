import { describe, it, expect } from "vitest"
import { buildUpstreamGeocodeUrl } from "@/lib/geocode/url"

describe("buildUpstreamGeocodeUrl", () => {
  it("injects the server key and ignores a client-supplied key", () => {
    const u = new URL(
      buildUpstreamGeocodeUrl(["Boise.json"], new URLSearchParams("key=CLIENT"), "SERVER")
    )
    expect(u.searchParams.get("key")).toBe("SERVER")
  })

  it("strips the trailing .json and percent-encodes the query", () => {
    const u = new URL(
      buildUpstreamGeocodeUrl(["Salt Lake City.json"], new URLSearchParams(), "K")
    )
    expect(u.hostname).toBe("api.maptiler.com")
    expect(u.pathname).toBe("/geocoding/Salt%20Lake%20City.json")
  })

  it("forwards only allow-listed params", () => {
    const u = new URL(
      buildUpstreamGeocodeUrl(
        ["x.json"],
        new URLSearchParams("country=us&types=place&proximity=-98,39&evil=1"),
        "K"
      )
    )
    expect(u.searchParams.get("country")).toBe("us")
    expect(u.searchParams.get("types")).toBe("place")
    expect(u.searchParams.get("proximity")).toBe("-98,39")
    expect(u.searchParams.has("evil")).toBe(false)
  })
})
