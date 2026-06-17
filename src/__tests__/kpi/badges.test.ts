import { describe, it, expect } from "vitest"
import { kpiBadge } from "@/lib/kpi/badges"

const m = (source?: "boulevard" | "sample") => ({ lastMonth: 1, momChange: 0, trend: [], updatedAt: "x", source })

describe("kpiBadge", () => {
  it("revenue from boulevard is live", () => {
    expect(kpiBadge("revenue", m("boulevard"))).toBe("live")
  })
  it("revenue without a boulevard source is sample", () => {
    expect(kpiBadge("revenue", m())).toBe("sample")
  })
  it("membership conversion without a boulevard source is pending", () => {
    expect(kpiBadge("membershipConversion", m())).toBe("pending")
  })
  it("membership conversion from boulevard is live", () => {
    expect(kpiBadge("membershipConversion", m("boulevard"))).toBe("live")
  })
  it("new clients and bookings are sample", () => {
    expect(kpiBadge("newClients", m())).toBe("sample")
    expect(kpiBadge("bookings", m())).toBe("sample")
  })
})
