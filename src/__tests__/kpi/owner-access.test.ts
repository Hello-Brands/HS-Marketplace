import { describe, it, expect } from "vitest"
import { canOwnerFetchLiveData } from "@/lib/kpi/access"

describe("canOwnerFetchLiveData", () => {
  it("allows a row whose owner is in the session's set", () => {
    expect(canOwnerFetchLiveData("owner-1", ["owner-1"], "Sugar House")).toBe(true)
  })

  it("allows a multi-profile owner for EITHER of their profiles", () => {
    const mine = ["ut-lines-towns", "ut-towns"]
    expect(canOwnerFetchLiveData("ut-lines-towns", mine, "UT Park City | Kimball Junction 235")).toBe(true)
    expect(canOwnerFetchLiveData("ut-towns", mine, "UT Ogden | Riverdale 082")).toBe(true)
  })

  it.each([
    ["an owner outside the set", "owner-3", ["owner-1", "owner-2"], "Sugar House"],
    ["an empty set", "owner-1", [], "Sugar House"],
    ["a null set", "owner-1", null, "Sugar House"],
    ["an undefined set", "owner-1", undefined, "Sugar House"],
    ["no resolved bq name", "owner-1", ["owner-1"], null],
  ] as const)("blocks %s", (_label, row, session, bq) => {
    expect(canOwnerFetchLiveData(row, session, bq)).toBe(false)
  })

  it("does not match on a prefix or substring", () => {
    expect(canOwnerFetchLiveData("ut-towns", ["ut-lines-towns"], "Sugar House")).toBe(false)
  })
})
