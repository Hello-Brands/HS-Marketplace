import { describe, it, expect } from "vitest"
import {
  planOwnerLinks,
  isEffectiveLinkSource,
  type ExistingOwnerLink,
} from "@/lib/owner-directory/link"

describe("isEffectiveLinkSource", () => {
  it.each([
    ["auto", true],
    ["manual", true],
    ["revoked", false],
  ] as const)("%s -> %s", (source, expected) => {
    expect(isEffectiveLinkSource(source)).toBe(expected)
  })
})

describe("planOwnerLinks reconciliation rules", () => {
  it("adds a matched owner with no existing row", () => {
    expect(planOwnerLinks({ matchedOwnerIdentifiers: ["ut-towns"], existingLinks: [] })).toEqual({
      toAdd: ["ut-towns"],
      toRemove: [],
      skipped: [],
    })
  })

  it("leaves a matched owner that is already auto (idempotent)", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["ut-towns"],
        existingLinks: [{ ownerIdentifier: "ut-towns", source: "auto" }],
      })
    ).toEqual({ toAdd: [], toRemove: [], skipped: [] })
  })

  it("never downgrades a matched manual link to auto", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["ut-towns"],
        existingLinks: [{ ownerIdentifier: "ut-towns", source: "manual" }],
      })
    ).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [{ ownerIdentifier: "ut-towns", reason: "manual" }],
    })
  })

  it("skips a matched owner the admin revoked", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["ut-towns"],
        existingLinks: [{ ownerIdentifier: "ut-towns", source: "revoked" }],
      })
    ).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [{ ownerIdentifier: "ut-towns", reason: "revoked" }],
    })
  })

  it("removes an auto link the directory no longer matches", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: [],
        existingLinks: [{ ownerIdentifier: "stale-owner", source: "auto" }],
      })
    ).toEqual({ toAdd: [], toRemove: ["stale-owner"], skipped: [] })
  })

  it("keeps an unmatched manual link (manual is durable)", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: [],
        existingLinks: [{ ownerIdentifier: "hand-added", source: "manual" }],
      })
    ).toEqual({ toAdd: [], toRemove: [], skipped: [] })
  })

  it("keeps an unmatched revoked link (suppression is durable)", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: [],
        existingLinks: [{ ownerIdentifier: "suppressed", source: "revoked" }],
      })
    ).toEqual({ toAdd: [], toRemove: [], skipped: [] })
  })
})

describe("planOwnerLinks properties", () => {
  it("collapses duplicate matches (one owner, several directory rows)", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["az-corp", "az-corp", "az-corp"],
        existingLinks: [],
      })
    ).toEqual({ toAdd: ["az-corp"], toRemove: [], skipped: [] })
  })

  it("is idempotent: applying a plan then re-planning yields an empty plan", () => {
    const matched = ["ut-lines-towns", "ut-towns"]
    const first = planOwnerLinks({ matchedOwnerIdentifiers: matched, existingLinks: [] })
    // Simulate applying `first`: every added owner is now an auto link.
    const applied: ExistingOwnerLink[] = first.toAdd.map((ownerIdentifier) => ({
      ownerIdentifier,
      source: "auto",
    }))
    expect(planOwnerLinks({ matchedOwnerIdentifiers: matched, existingLinks: applied })).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [],
    })
  })

  it("links Austin Towns to BOTH Utah owner profiles (the reported bug)", () => {
    // Real data: austin@hellosugar.salon is the contact on ut-lines-towns (8
    // locations) and ut-towns (1). The old decideOwnerLink skipped him entirely
    // with reason "multiple_owners"; both must now be linked.
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["ut-lines-towns", "ut-towns"],
        existingLinks: [],
      })
    ).toEqual({ toAdd: ["ut-lines-towns", "ut-towns"], toRemove: [], skipped: [] })
  })

  it("handles a mixed set in one pass", () => {
    expect(
      planOwnerLinks({
        matchedOwnerIdentifiers: ["fresh", "already-auto", "hand-added", "suppressed"],
        existingLinks: [
          { ownerIdentifier: "already-auto", source: "auto" },
          { ownerIdentifier: "hand-added", source: "manual" },
          { ownerIdentifier: "suppressed", source: "revoked" },
          { ownerIdentifier: "stale", source: "auto" },
        ],
      })
    ).toEqual({
      toAdd: ["fresh"],
      toRemove: ["stale"],
      skipped: [
        { ownerIdentifier: "hand-added", reason: "manual" },
        { ownerIdentifier: "suppressed", reason: "revoked" },
      ],
    })
  })

  it("returns empty for no matches and no existing links", () => {
    expect(planOwnerLinks({ matchedOwnerIdentifiers: [], existingLinks: [] })).toEqual({
      toAdd: [],
      toRemove: [],
      skipped: [],
    })
  })
})
