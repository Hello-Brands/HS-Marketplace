import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder, type ChainedBuilder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const { select } = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

import { listAuditLog } from "@/lib/mcp/queries/audit"
import { decodeCursor } from "@/lib/mcp/tools/_shared"

function row(id: string, at: string) {
  return {
    id,
    createdAt: new Date(at),
    action: "listing.approve",
    source: "mcp",
    mcpClientId: "claude-code",
    actorUserId: "u-1",
    actorName: "Parker",
    actorEmail: "parker@hellosugar.salon",
    targetType: "listing",
    targetId: "l-1",
    outcome: "ok",
    error: null,
    durationMs: 84,
    args: { listing_id: "l-1" },
  }
}

describe("listAuditLog", () => {
  let b: ChainedBuilder

  beforeEach(() => {
    select.mockReset()
    b = builder([row("a1", "2026-09-14T12:00:00.000Z"), row("a2", "2026-09-14T11:00:00.000Z")])
    select.mockReturnValue(b)
  })

  it("serialises a row into the wire shape", async () => {
    const page = await listAuditLog({ limit: 25 })
    expect(page.items[0]).toEqual({
      id: "a1",
      at: "2026-09-14T12:00:00.000Z",
      action: "listing.approve",
      source: "mcp",
      actor: { id: "u-1", name: "Parker", email: "parker@hellosugar.salon" },
      client_id: "claude-code",
      target: { type: "listing", id: "l-1" },
      outcome: "ok",
      error: null,
      duration_ms: 84,
      args: { listing_id: "l-1" },
    })
  })

  it("asks for one more row than the limit so it knows whether a page follows", async () => {
    await listAuditLog({ limit: 25 })
    expect(b.calls.limit[0][0]).toBe(26)
  })

  it("returns a null cursor when the fetched rows fit in the page", async () => {
    expect((await listAuditLog({ limit: 25 })).next_cursor).toBeNull()
  })

  it("trims the sentinel row and emits a keyset cursor when more remain", async () => {
    select.mockReturnValue(
      builder([
        row("a1", "2026-09-14T12:00:00.000Z"),
        row("a2", "2026-09-14T11:00:00.000Z"),
        row("a3", "2026-09-14T10:00:00.000Z"),
      ]),
    )
    const page = await listAuditLog({ limit: 2 })
    expect(page.items.map((i) => i.id)).toEqual(["a1", "a2"])
    expect(decodeCursor(page.next_cursor!)).toEqual({ at: "2026-09-14T11:00:00.000Z", id: "a2" })
  })

  it("excludes mcp.read rows by default and includes them on request", async () => {
    await listAuditLog({ limit: 25 })
    const defaultWhere = b.calls.where[0][0]
    b = builder([])
    select.mockReturnValue(b)
    await listAuditLog({ limit: 25, includeReads: true })
    const inclusiveWhere = b.calls.where[0][0]
    // Not asserting SQL internals (a Drizzle SQL object is circular and cannot be
    // stringified) — only that with no other filter the default call still builds a
    // predicate, the mcp.read exclusion, and the inclusive call builds none at all.
    expect(defaultWhere).toBeDefined()
    expect(inclusiveWhere).toBeUndefined()
  })

  it("orders newest first so the cursor walks backwards in time", async () => {
    await listAuditLog({ limit: 25 })
    expect(b.calls.orderBy[0]).toHaveLength(2)
  })

  it("applies a garbage cursor as no cursor rather than throwing", async () => {
    await expect(listAuditLog({ limit: 25, cursor: "###" })).resolves.toBeDefined()
  })
})
