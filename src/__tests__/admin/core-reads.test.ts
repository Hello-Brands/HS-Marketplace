import { describe, it, expect, vi } from "vitest"
import { builder } from "../../../test/helpers/drizzle-mock"

const { select } = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => select(...a) } }))

import { getInquiries } from "@/lib/admin/core/inquiries"

describe("core getInquiries", () => {
  it("defaults to the last 100 and honors a custom limit", async () => {
    const b = builder([{ id: "c1" }])
    select.mockReturnValue(b)
    expect(await getInquiries()).toEqual([{ id: "c1" }])
    expect(b.calls.limit[0]).toEqual([100])

    const b2 = builder([])
    select.mockReturnValue(b2)
    await getInquiries({ limit: 25 })
    expect(b2.calls.limit[0]).toEqual([25])
  })
})
