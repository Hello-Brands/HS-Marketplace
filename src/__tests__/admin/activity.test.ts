import { describe, it, expect, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock("@/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }))

import {
  encodeActivityCursor,
  decodeActivityCursor,
  summarizeActivity,
  getRecentActivity,
  type ActivityRawRow,
} from "@/lib/admin/activity"

const at = new Date("2026-09-14T12:00:00.000Z")

describe("activity cursor", () => {
  it("round-trips", () => {
    const c = encodeActivityCursor({ at, kind: "inquiry", id: "c1" })
    expect(decodeActivityCursor(c)).toEqual({ at, kind: "inquiry", id: "c1" })
  })

  it("rejects garbage and unknown kinds", () => {
    expect(decodeActivityCursor("not-base64!")).toBeNull()
    expect(decodeActivityCursor(Buffer.from(JSON.stringify({ at: at.toISOString(), kind: "nope", id: "x" })).toString("base64url"))).toBeNull()
    expect(decodeActivityCursor(null)).toBeNull()
  })
})

function raw(over: Partial<ActivityRawRow>): ActivityRawRow {
  return {
    at,
    kind: "inquiry",
    id: "x",
    actor_id: "u1",
    actor_name: "Pat",
    actor_email: "pat@x.com",
    target_type: "listing",
    target_id: "l1",
    target_label: "Sugar House",
    detail: null,
    source: null,
    outcome: null,
    ...over,
  }
}

describe("summarizeActivity", () => {
  it("describes admin actions with verb, target and source", () => {
    expect(summarizeActivity(raw({ kind: "admin_action", detail: "listing.approve", source: "mcp", outcome: "ok" })))
      .toBe("Pat approved listing “Sugar House” via MCP")
  })
  it("marks failed admin actions", () => {
    expect(summarizeActivity(raw({ kind: "admin_action", detail: "user.remove", target_type: "user", target_label: "a@b.com", source: "ui", outcome: "error" })))
      .toBe("Pat removed user “a@b.com” (failed)")
  })
  it("falls back to email then 'Someone' for the actor", () => {
    expect(summarizeActivity(raw({ actor_name: null }))).toBe("pat@x.com inquired about “Sugar House”")
    expect(summarizeActivity(raw({ actor_name: null, actor_email: null }))).toBe("Someone inquired about “Sugar House”")
  })
  it("covers every kind", () => {
    expect(summarizeActivity(raw({ kind: "listing_created" }))).toBe("Pat created listing “Sugar House”")
    expect(summarizeActivity(raw({ kind: "listing_listed" }))).toBe("Listing “Sugar House” went live")
    expect(summarizeActivity(raw({ kind: "listing_updated" }))).toBe("Listing “Sugar House” was updated")
    expect(summarizeActivity(raw({ kind: "favorite" }))).toBe("Pat saved “Sugar House”")
    expect(summarizeActivity(raw({ kind: "login", target_type: "user", target_label: null }))).toBe("Pat signed in")
    expect(summarizeActivity(raw({ kind: "brand_request_submitted", target_type: "brand_request", target_label: "Wax Rivals" }))).toBe("Pat requested brand “Wax Rivals”")
    expect(summarizeActivity(raw({ kind: "brand_request_decided", target_type: "brand_request", target_label: "Wax Rivals", detail: "approved" }))).toBe("Pat approved brand request “Wax Rivals”")
    expect(summarizeActivity(raw({ kind: "owner_link_changed", target_type: "user", target_label: "o@x.com", detail: "manual" }))).toBe("Pat set owner link for “o@x.com” to manual")
  })
})

describe("getRecentActivity", () => {
  it("maps rows, trims to limit and returns a cursor when there is more", async () => {
    const rows = [1, 2, 3].map((n) => raw({ id: `c${n}`, at: new Date(at.getTime() - n * 1000) }))
    execute.mockResolvedValue({ rows })
    const out = await getRecentActivity({ limit: 2 })
    expect(out.items).toHaveLength(2)
    expect(out.items[0]).toMatchObject({ kind: "inquiry", id: "c1", actor: { id: "u1", name: "Pat", email: "pat@x.com" }, target: { type: "listing", id: "l1", label: "Sugar House" } })
    expect(decodeActivityCursor(out.nextCursor)).toEqual({ at: rows[1].at, kind: "inquiry", id: "c2" })
  })

  it("returns null cursor at the end", async () => {
    execute.mockResolvedValue({ rows: [raw({ id: "c1" })] })
    expect((await getRecentActivity({ limit: 25 })).nextCursor).toBeNull()
  })

  // The cursor round-trips through a JS Date (ms), so every UNION branch must
  // truncate to ms or the (at, kind, id) tuple compare skips sub-ms siblings.
  it("truncates every union branch timestamp to milliseconds", async () => {
    execute.mockResolvedValue({ rows: [] })
    await getRecentActivity({ limit: 5 })
    const rendered = new PgDialect().sqlToQuery(execute.mock.calls[0][0] as SQL).sql
    expect(rendered.match(/date_trunc\('milliseconds'/g)).toHaveLength(10)
  })
})
