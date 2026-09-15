import { describe, it, expect } from "vitest"
import { uiActor, uiActorFromSession } from "@/lib/admin/core/actor"

describe("AdminActor helpers", () => {
  it("uiActor builds a ui-source actor", () => {
    expect(uiActor("u1")).toEqual({ userId: "u1", source: "ui" })
  })

  it("uiActorFromSession uses the session user id", () => {
    expect(uiActorFromSession({ id: "u2" })).toEqual({ userId: "u2", source: "ui" })
  })

  it("uiActorFromSession throws when the session has no id", () => {
    expect(() => uiActorFromSession({})).toThrow("Unauthorized")
    expect(() => uiActorFromSession({ id: null })).toThrow("Unauthorized")
  })
})
