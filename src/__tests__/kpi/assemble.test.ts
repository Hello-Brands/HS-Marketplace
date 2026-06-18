import { describe, it, expect, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { buildLocationKpi } from "@/lib/kpi/assemble"
import type { KpiMetric } from "@/lib/kpi/schema"

const metric = (source: "bigquery" | "sample", v: number): KpiMetric => ({
  lastMonth: v, momChange: 0, trend: [{ month: "YTD", value: v }], updatedAt: "x", source,
})

describe("buildLocationKpi", () => {
  it("shows live BigQuery membership even when the base KPI fetch returned null", () => {
    const data = buildLocationKpi(null, null, metric("bigquery", 33.9))
    expect(data.membershipConversion?.lastMonth).toBe(33.9)
    expect(data.membershipConversion?.source).toBe("bigquery")
  })

  it("overlays BigQuery revenue + membership over the base", () => {
    const base = { revenue: metric("sample", 1), membershipConversion: metric("sample", 2) }
    const data = buildLocationKpi(base, metric("bigquery", 100), metric("bigquery", 33.9))
    expect(data.revenue?.source).toBe("bigquery")
    expect(data.membershipConversion?.lastMonth).toBe(33.9)
  })

  it("always hides newClients and bookings (no live source)", () => {
    const base = { newClients: metric("sample", 5), bookings: metric("sample", 9), revenue: metric("sample", 1) }
    const data = buildLocationKpi(base, null, null)
    expect(data.newClients).toBeUndefined()
    expect(data.bookings).toBeUndefined()
  })

  it("returns empty (no revenue/membership) when nothing is available", () => {
    const data = buildLocationKpi(null, null, null)
    expect(data.revenue).toBeUndefined()
    expect(data.membershipConversion).toBeUndefined()
  })
})
