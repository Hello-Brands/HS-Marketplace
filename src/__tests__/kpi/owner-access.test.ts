import { describe, it, expect } from "vitest"
import { canOwnerFetchLiveData } from "@/lib/kpi/access"

describe("canOwnerFetchLiveData", () => {
  it("allows the row's owner when a resolved BigQuery name exists", () => {
    expect(canOwnerFetchLiveData("owner-1", "owner-1", "Sugar House")).toBe(true)
  })
  it.each([
    ["different owner", "owner-1", "owner-2", "Sugar House"],
    ["no session owner (null)", "owner-1", null, "Sugar House"],
    ["no session owner (undefined)", "owner-1", undefined, "Sugar House"],
    ["empty session owner", "owner-1", "", "Sugar House"],
    ["no resolved bq name", "owner-1", "owner-1", null],
  ] as const)("blocks %s", (_label, row, session, bq) => {
    expect(canOwnerFetchLiveData(row, session, bq)).toBe(false)
  })
})
