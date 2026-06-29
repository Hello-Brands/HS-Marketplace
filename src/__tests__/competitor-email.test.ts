import { describe, it, expect } from "vitest"
import { buildCompetitorAlertEmail } from "@/lib/email"

const data = {
  buyerEmail: "b@example.com",
  buyerName: "Pat",
  searchName: "Phoenix metro",
  searchUrl: "https://x/browse?centerLat=33",
  competitors: [
    { brandName: "European Wax Center", city: "Tempe", state: "AZ", nearestHsName: "Watermark", nearestHsMiles: 2.3, mapsUrl: "https://maps/x" },
    { brandName: "Sugaring NYC", city: "Mesa", state: "AZ", nearestHsName: null, nearestHsMiles: null, mapsUrl: null },
  ],
}

describe("buildCompetitorAlertEmail", () => {
  it("pluralizes the subject by competitor count", () => {
    expect(buildCompetitorAlertEmail(data).subject).toContain("2 new competitor closures")
    expect(buildCompetitorAlertEmail({ ...data, competitors: [data.competitors[0]] }).subject)
      .toContain("1 new competitor closure near")
  })
  it("renders each competitor, the search name, and the search link", () => {
    const { html } = buildCompetitorAlertEmail(data)
    expect(html).toContain("European Wax Center")
    expect(html).toContain("Sugaring NYC")
    expect(html).toContain("Phoenix metro")
    expect(html).toContain("Tempe, AZ")
    expect(html).toContain("Watermark")
    expect(html).toContain(data.searchUrl)
  })
})
