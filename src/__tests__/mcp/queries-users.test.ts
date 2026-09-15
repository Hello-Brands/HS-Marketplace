import { describe, it, expect, vi, beforeEach } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

vi.mock("server-only", () => ({}))

const { select } = vi.hoisted(() => ({ select: vi.fn() }))

vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

import { userDetail } from "@/lib/mcp/queries/users"

describe("userDetail", () => {
  beforeEach(() => {
    select.mockReset()
    // Call order must match the Promise.all array in the implementation:
    // 1 owner links, 2 listings, 3 alerts, 4 favorites.
    select
      .mockReturnValueOnce(
        builder([
          {
            ownerIdentifier: "Austin LLC",
            source: "revoked",
            updatedAt: new Date("2026-07-01T00:00:00.000Z"),
          },
        ]),
      )
      .mockReturnValueOnce(builder([{ id: "l-1", title: "Aspen", status: "active" }]))
      .mockReturnValueOnce(
        builder([
          {
            id: "a-1",
            name: "CO suites",
            notifyEnabled: true,
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
          },
        ]),
      )
      .mockReturnValueOnce(
        builder([{ listingId: "l-9", createdAt: new Date("2026-06-02T00:00:00.000Z") }]),
      )
  })

  it("surfaces a revoked owner link rather than hiding it", async () => {
    const detail = await userDetail("u-2")
    expect(detail.owner_links).toEqual([
      {
        owner_identifier: "Austin LLC",
        source: "revoked",
        updated_at: "2026-07-01T00:00:00.000Z",
      },
    ])
  })

  it("shapes listings, alerts and favorites with snake_case keys and ISO timestamps", async () => {
    const detail = await userDetail("u-2")
    expect(detail.listings).toEqual([{ id: "l-1", title: "Aspen", status: "active" }])
    expect(detail.alerts).toEqual([
      {
        id: "a-1",
        name: "CO suites",
        notify_enabled: true,
        created_at: "2026-06-01T00:00:00.000Z",
      },
    ])
    expect(detail.favorites).toEqual([
      { listing_id: "l-9", created_at: "2026-06-02T00:00:00.000Z" },
    ])
  })

  it("caps each relation so one prolific user cannot flood the tool result", async () => {
    await userDetail("u-2")
    // The owner-link query is deliberately uncapped (one row per owner); the three
    // unbounded relations each take the shared limit.
    const limited = select.mock.results
      .map((r) => (r.value as ReturnType<typeof builder>).calls.limit)
      .filter(Boolean)
    expect(limited).toEqual([[[50]], [[50]], [[50]]])
  })
})
