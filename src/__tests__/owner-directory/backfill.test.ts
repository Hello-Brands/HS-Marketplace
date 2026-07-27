import { describe, it, expect } from "vitest"
import { planBackfillRows } from "@/lib/owner-directory/backfill"

describe("planBackfillRows", () => {
  it("carries an auto link across as auto", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: "ut-towns",
        ownerLinkSource: "auto",
        emailMatchedOwners: ["ut-towns", "ut-lines-towns"],
      })
    ).toEqual([{ userId: "u1", ownerIdentifier: "ut-towns", source: "auto" }])
  })

  it("carries a manual link across as manual", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: "ut-lines-towns",
        ownerLinkSource: "manual",
        emailMatchedOwners: [],
      })
    ).toEqual([{ userId: "u1", ownerIdentifier: "ut-lines-towns", source: "manual" }])
  })

  it("treats a set identifier with a null source as auto rather than dropping it", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: "az-corp",
        ownerLinkSource: null,
        emailMatchedOwners: [],
      })
    ).toEqual([{ userId: "u1", ownerIdentifier: "az-corp", source: "auto" }])
  })

  it("converts a deliberate unlink into a revocation for EVERY matching owner", () => {
    // manuallyUnlinkUser wrote {ownerIdentifier: null, source: "manual"}. That
    // means "do not re-link me" — without revocations the next login would
    // auto-link them and reverse the admin's decision.
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: null,
        ownerLinkSource: "manual",
        emailMatchedOwners: ["ut-lines-towns", "ut-towns"],
      })
    ).toEqual([
      { userId: "u1", ownerIdentifier: "ut-lines-towns", source: "revoked" },
      { userId: "u1", ownerIdentifier: "ut-towns", source: "revoked" },
    ])
  })

  it("produces nothing for a deliberate unlink whose email matches nothing", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: null,
        ownerLinkSource: "manual",
        emailMatchedOwners: [],
      })
    ).toEqual([])
  })

  it("produces no rows for a legacy UNKNOWN_OWNER identifier", () => {
    // Unreachable today (both legacy write paths rejected this value) but
    // owner_identifier is a soft reference, so guard it the same way the
    // email-match branch already excludes UNKNOWN_OWNER.
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: "Unknown Owner",
        ownerLinkSource: null,
        emailMatchedOwners: [],
      })
    ).toEqual([])
  })

  it("produces nothing for a plain never-linked user", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: null,
        ownerLinkSource: null,
        emailMatchedOwners: ["az-corp"],
      })
    ).toEqual([])
  })

  it("dedupes and sorts revocations", () => {
    expect(
      planBackfillRows({
        userId: "u1",
        ownerIdentifier: null,
        ownerLinkSource: "manual",
        emailMatchedOwners: ["z-owner", "a-owner", "z-owner"],
      }).map((r) => r.ownerIdentifier)
    ).toEqual(["a-owner", "z-owner"])
  })
})
