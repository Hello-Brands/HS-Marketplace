import { describe, it, expect } from "vitest"
import { kpiBadge } from "@/lib/kpi/badges"

const m = (source?: "bigquery" | "sample") => ({ lastMonth: 1, momChange: 0, trend: [], updatedAt: "x", source })

describe("kpiBadge", () => {
  it("revenue from bigquery is live", () => {
    expect(kpiBadge("revenue", m("bigquery"))).toBe("live")
  })
  it("revenue without a bigquery source is sample", () => {
    expect(kpiBadge("revenue", m())).toBe("sample")
  })
  it("membership conversion without a bigquery source is pending", () => {
    expect(kpiBadge("membershipConversion", m())).toBe("pending")
  })
  it("membership conversion from bigquery is live", () => {
    expect(kpiBadge("membershipConversion", m("bigquery"))).toBe("live")
  })
  it("new clients and bookings are sample", () => {
    expect(kpiBadge("newClients", m())).toBe("sample")
    expect(kpiBadge("bookings", m())).toBe("sample")
  })
})
