import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const { select } = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

import { listBrandRequests, getBrandRequestDetail } from "@/lib/mcp/queries/brand-requests"
import { decodeCursor } from "@/lib/mcp/tools/_shared"

function row(id: string, at: string, over: Record<string, unknown> = {}) {
  return {
    id,
    brandName: "Waxing Co",
    websiteUrl: "https://waxing.co",
    normalizedDomain: "waxing.co",
    status: "recon_complete",
    note: null,
    knownCityState: "Denver, CO",
    submittedBy: "u-2",
    submitterName: "Dana",
    submitterEmail: "dana@example.com",
    decidedBy: null,
    decidedAt: null,
    rejectReason: null,
    brandId: null,
    prUrl: null,
    issueUrl: null,
    locationsFound: 41,
    error: null,
    recon: { estMonthlyCost: 12 },
    createdAt: new Date(at),
    updatedAt: new Date(at),
    ...over,
  }
}

describe("listBrandRequests", () => {
  let b: ChainedBuilder

  beforeEach(() => {
    select.mockReset()
    b = builder([row("br-1", "2026-09-14T12:00:00.000Z"), row("br-2", "2026-09-14T11:00:00.000Z")])
    select.mockReturnValue(b)
  })

  it("serialises a row into the wire shape", async () => {
    const page = await listBrandRequests({ limit: 25 })
    expect(page.items[0]).toEqual({
      id: "br-1",
      brand_name: "Waxing Co",
      website_url: "https://waxing.co",
      normalized_domain: "waxing.co",
      status: "recon_complete",
      note: null,
      known_city_state: "Denver, CO",
      submitted_by: { id: "u-2", name: "Dana", email: "dana@example.com" },
      decided_by: null,
      decided_at: null,
      reject_reason: null,
      brand_id: null,
      pr_url: null,
      issue_url: null,
      locations_found: 41,
      error: null,
      created_at: "2026-09-14T12:00:00.000Z",
      updated_at: "2026-09-14T12:00:00.000Z",
    })
    // `recon` belongs to the detail read only — the list stays small.
    expect(page.items[0]).not.toHaveProperty("recon")
  })

  it("serialises a decided timestamp", async () => {
    select.mockReturnValue(
      builder([
        row("br-1", "2026-09-14T12:00:00.000Z", {
          decidedBy: "u-1",
          decidedAt: new Date("2026-09-15T09:30:00.000Z"),
        }),
      ]),
    )
    const page = await listBrandRequests({ limit: 25 })
    expect(page.items[0].decided_at).toBe("2026-09-15T09:30:00.000Z")
  })

  it("asks for one more row than the limit so it knows whether a page follows", async () => {
    await listBrandRequests({ limit: 25 })
    expect(b.calls.limit[0][0]).toBe(26)
  })

  it("returns a null cursor when the fetched rows fit in the page", async () => {
    expect((await listBrandRequests({ limit: 25 })).next_cursor).toBeNull()
  })

  it("trims the sentinel row and emits a keyset cursor when more remain", async () => {
    const page = await listBrandRequests({ limit: 1 })
    expect(page.items.map((i) => i.id)).toEqual(["br-1"])
    expect(decodeCursor(page.next_cursor ?? undefined)).toEqual({
      at: "2026-09-14T12:00:00.000Z",
      id: "br-1",
    })
  })

  it("queries the database again on every call — this table is never cached", async () => {
    await listBrandRequests({ limit: 25 })
    await listBrandRequests({ limit: 25 })
    expect(select).toHaveBeenCalledTimes(2)
  })
})

describe("getBrandRequestDetail", () => {
  beforeEach(() => {
    select.mockReset()
  })

  it("returns the row with the monitor-written recon payload", async () => {
    select.mockReturnValue(builder([row("br-1", "2026-09-14T12:00:00.000Z")]))
    const detail = await getBrandRequestDetail("br-1")
    expect(detail?.id).toBe("br-1")
    expect(detail?.recon).toEqual({ estMonthlyCost: 12 })
  })

  it("normalises a missing recon to null rather than undefined", async () => {
    select.mockReturnValue(builder([row("br-1", "2026-09-14T12:00:00.000Z", { recon: null })]))
    expect((await getBrandRequestDetail("br-1"))?.recon).toBeNull()
  })

  it("returns null for an unknown id", async () => {
    select.mockReturnValue(builder([]))
    expect(await getBrandRequestDetail("nope")).toBeNull()
  })
})
